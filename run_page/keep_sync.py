import argparse
import base64
import json
import os
import time
import zlib
from collections import namedtuple
from datetime import datetime, timedelta, timezone

import eviltransform
import gpxpy
import polyline
import requests
from config import GPX_FOLDER, JSON_FILE, SQL_FILE, run_map, start_point
from Crypto.Cipher import AES
from generator import Generator
from utils import adjust_time
import xml.etree.ElementTree as ET

# 不再按运动分类限制抓取：列表接口使用 type=all 拉取账号下全部运动类型。
# 详情接口路径的 sport_type 由列表 stats 的 type 字段（或 schema，如 keep://hikinglogs/..）决定；
# 注意 run_id 已改为 MongoDB 风格 ID，不再含 dataType 前缀，也无法从 dataType 推导 URL。
KEEP_SPORT_TYPES = ["running", "hiking", "cycling"]  # 仅作历史参考，不再用于限制抓取

LOGIN_API = "https://api.gotokeep.com/v1.1/users/login"
RUN_DATA_API = "https://api.gotokeep.com/pd/v3/stats/detail?dateUnit=all&type=all&lastDate={last_date}"
RUN_LOG_API = "https://api.gotokeep.com/pd/v3/{sport_type}log/{run_id}"

HR_FRAME_THRESHOLD_IN_DECISECOND = 100  # Maximum time difference to consider a data point as the nearest, the unit is decisecond(分秒)

TIMESTAMP_THRESHOLD_IN_DECISECOND = 3_600_000  # Threshold for target timestamp adjustment, the unit of timestamp is decisecond(分秒), so the 3_600_000 stands for 100 hours sports time. 100h = 100 * 60 * 60 * 10

# If your points need trans from gcj02 to wgs84 coordinate which use by Mapbox
TRANS_GCJ02_TO_WGS84 = True


def login(session, mobile, password):
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0",
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    }
    data = {"mobile": mobile, "password": password}
    r = session.post(LOGIN_API, headers=headers, data=data)
    if r.ok:
        token = r.json()["data"]["token"]
        headers["Authorization"] = f"Bearer {token}"
        return session, headers


def get_to_download_runs_ids(session, headers):
    last_date = 0
    result = []

    while 1:
        r = session.get(
            RUN_DATA_API.format(last_date=last_date),
            headers=headers,
        )
        if r.ok:
            run_logs = r.json()["data"]["records"]

            for i in run_logs:
                for j in i.get("logs", []):
                    st = j.get("stats") or {}
                    if st and st.get("id") and not st.get("isDoubtful"):
                        result.append((st["id"], sport_type_of(st)))
            last_date = r.json()["data"]["lastTimestamp"]
            since_time = datetime.fromtimestamp(last_date / 1000, tz=timezone.utc)
            print(f"pares keep ids data since {since_time}")
            time.sleep(1)  # spider rule
            if not last_date:
                break
    return result


def derive_log_sport_type(data_type):
    """Keep 详情接口路径用短分类（running/hiking/cycling…），需去掉 outdoor/indoor 前缀。
    例如 outdoorRunning -> running, indoorCycling -> cycling, outdoorHiking -> hiking。
    仅作为最后的兜底（当 stats 没有 type/schema 时）。
    """
    for prefix in ("outdoor", "indoor"):
        if data_type.startswith(prefix):
            return data_type[len(prefix):].lower()
    return data_type.lower()


def sport_type_of(stats):
    """从列表 stats 推导详情接口所需的 sport_type。

    Keep 改版后 run_id 是 MongoDB 风格 ID，不再含运动类型；正确的 sport_type 来自：
      1) stats.type 字段（如 "hiking"）
      2) stats.schema（如 "keep://hikinglogs/{id}" -> "hiking"）
    二者都缺失时，才从 dataType 兜底推导（旧逻辑，可能对不上）。
    """
    t = (stats.get("type") or "").strip()
    if t:
        return t
    schema = stats.get("schema") or ""
    if "logs/" in schema:
        return schema.split("logs/")[0].rstrip("/").split("/")[-1]
    return derive_log_sport_type(stats.get("dataType") or "")


def keep_sport_type(run_data):
    """接口原始运动类型，不再映射为 Strava 类型（保持与接口一致）。"""
    return run_data.get("type") or run_data.get("dataType") or ""


def keep_activity_name(run_data):
    """活动名称 = 行政区划(district，缺失时回退 city) + 接口活动名。

    例如 region.district='青羊区'、name='跑步' -> '青羊区 跑步'；
    region 无 district 时回退到 city，如 '宜宾市 徒步/远足'。
    """
    region = run_data.get("region") or {}
    district = ""
    if isinstance(region, dict):
        district = region.get("district") or region.get("city") or ""
    activity_name = run_data.get("name") or ""
    if district:
        return f"{district} {activity_name}"
    return activity_name


def get_single_run_data(session, headers, run_id, sport_type):
    # sport_type 来自列表 stats（type/schema），直接拼详情 URL
    r = session.get(
        RUN_LOG_API.format(sport_type=sport_type, run_id=run_id), headers=headers
    )
    if r.ok:
        return r.json()
    return None


def decode_runmap_data(text, is_geo=False):
    _bytes = base64.b64decode(text)
    key = "NTZmZTU5OzgyZzpkODczYw=="
    iv = "MjM0Njg5MjQzMjkyMDMwMA=="
    if is_geo:
        cipher = AES.new(base64.b64decode(key), AES.MODE_CBC, base64.b64decode(iv))
        _bytes = cipher.decrypt(_bytes)
    run_points_data = zlib.decompress(_bytes, 16 + zlib.MAX_WBITS)
    run_points_data = json.loads(run_points_data)
    return run_points_data


def parse_raw_data_to_nametuple(
    run_data,
    old_gpx_ids,
    session,
    with_download_gpx=False,
):
    # 新版详情响应不再包裹在 data 下；兼容旧版（有 data 包裹）的情况
    run_data = run_data.get("data") or run_data
    run_points_data = []

    # 5898009e387e28303988f3b7_9223370441312156007_rn middle
    keep_id = run_data["id"].split("_")[1]

    start_time = run_data["startTime"]
    avg_heart_rate = None
    elevation_gain = None
    decoded_hr_data = []
    heart_rate = run_data.get("heartRate") or {}
    if heart_rate:
        avg_heart_rate = heart_rate.get("averageHeartRate", None)
        heart_rate_data = heart_rate.get("heartRates", None)
        if heart_rate_data:
            decoded_hr_data = decode_runmap_data(heart_rate_data)
        # fix #66
        if avg_heart_rate and avg_heart_rate < 0:
            avg_heart_rate = None

    if run_data.get("geoPoints"):
        run_points_data = decode_runmap_data(run_data["geoPoints"], True)
        run_points_data_gpx = run_points_data
        if TRANS_GCJ02_TO_WGS84:
            run_points_data = [
                list(eviltransform.gcj2wgs(p["latitude"], p["longitude"]))
                for p in run_points_data
            ]
            for i, p in enumerate(run_points_data_gpx):
                p["latitude"] = run_points_data[i][0]
                p["longitude"] = run_points_data[i][1]

        for p in run_points_data_gpx:
            if "timestamp" not in p:
                if "unixTimestamp" in p:
                    p["timestamp"] = p["unixTimestamp"]
                else:
                    p["timestamp"] = 0
            p_hr = find_nearest_hr(decoded_hr_data, int(p["timestamp"]), start_time)
            if p_hr:
                p["hr"] = p_hr
        if run_points_data:
            gpx_data = parse_points_to_gpx(
                run_points_data_gpx, start_time, keep_sport_type(run_data)
            )
            elevation_gain = gpx_data.get_uphill_downhill().uphill
            if with_download_gpx and str(keep_id) not in old_gpx_ids:
                download_keep_gpx(gpx_data.to_xml(), str(keep_id))
    else:
        print(f"ID {keep_id} no gps data")
    polyline_str = polyline.encode(run_points_data) if run_points_data else ""
    start_latlng = start_point(*run_points_data[0]) if run_points_data else None
    start_date = datetime.fromtimestamp(start_time / 1000, tz=timezone.utc)
    tz_name = run_data.get("timezone", "")
    start_date_local = adjust_time(start_date, tz_name)
    end = datetime.fromtimestamp(run_data["endTime"] / 1000, tz=timezone.utc)
    end_local = adjust_time(end, tz_name)
    if not run_data.get("duration"):
        print(f"ID {keep_id} has no total time just ignore please check")
        return
    d = {
        "id": int(keep_id),
        "name": keep_activity_name(run_data),
        "type": keep_sport_type(run_data),
        "subtype": keep_sport_type(run_data),
        "start_date": datetime.strftime(start_date, "%Y-%m-%d %H:%M:%S"),
        "end": datetime.strftime(end, "%Y-%m-%d %H:%M:%S"),
        "start_date_local": datetime.strftime(start_date_local, "%Y-%m-%d %H:%M:%S"),
        "end_local": datetime.strftime(end_local, "%Y-%m-%d %H:%M:%S"),
        "length": run_data["distance"],
        "average_heartrate": int(avg_heart_rate) if avg_heart_rate else None,
        "elevation_gain": run_data.get("accumulativeUpliftedHeight"),
        "map": run_map(polyline_str),
        "start_latlng": start_latlng,
        "distance": run_data["distance"],
        "moving_time": timedelta(seconds=run_data["duration"]),
        "elapsed_time": timedelta(
            seconds=int((run_data["endTime"] - run_data["startTime"]) / 1000)
        ),
        "average_speed": run_data["distance"] / run_data["duration"],
        "elevation_gain": elevation_gain,
        # 优先用详情里的 region 国家/地区；缺失时留空，后续可 reverse_geocode 反查
        "location_country": (
            run_data.get("region", {}).get("country", "")
            if isinstance(run_data.get("region"), dict)
            else ""
        ),
        # calories: 接口字段名为 calorie（个别返回为 calories 时兼容）
        "calories": run_data.get("calorie", run_data.get("calories")),
        # source: 优先用设备型号 deviceModel，缺失回退 "Keep"
        "source": run_data.get("deviceModel") or "Keep",
    }
    return namedtuple("x", d.keys())(*d.values())


def get_all_keep_tracks(email, password, old_tracks_ids, with_download_gpx=False):
    if with_download_gpx and not os.path.exists(GPX_FOLDER):
        os.mkdir(GPX_FOLDER)
    s = requests.Session()
    s, headers = login(s, email, password)
    tracks = []
    # 不再按分类循环：一次性拉取账号下全部运动类型的记录
    runs = get_to_download_runs_ids(s, headers)
    runs = [(rid, st) for rid, st in runs if rid.split("_")[1] not in old_tracks_ids]
    print(f"{len(runs)} new keep data to generate")
    old_gpx_ids = os.listdir(GPX_FOLDER)
    old_gpx_ids = [i.split(".")[0] for i in old_gpx_ids if not i.startswith(".")]
    for run_id, sport_type in runs:
        print(f"parsing keep id {run_id} (type={sport_type})")
        try:
            run_data = get_single_run_data(s, headers, run_id, sport_type)
            track = parse_raw_data_to_nametuple(
                run_data, old_gpx_ids, s, with_download_gpx
            )
            if track is not None:
                tracks.append(track)
        except Exception as e:
            print(f"Something wrong paring keep id {run}" + str(e))
    return tracks


def parse_points_to_gpx(run_points_data, start_time, sport_type):
    """
    Convert run points data to GPX format.

    Args:
        run_id (str): The ID of the run.
        run_points_data (list of dict): A list of run data points.
        start_time (int): The start time for adjusting timestamps. Note that the unit of the start_time is millisecond

    Returns:
        gpx_data (str): GPX data in string format.
    """
    points_dict_list = []
    # early timestamp fields in keep's data stands for delta time, but in newly data timestamp field stands for exactly time,
    # so it does'nt need to plus extra start_time
    if run_points_data[0]["timestamp"] > TIMESTAMP_THRESHOLD_IN_DECISECOND:
        start_time = 0

    for point in run_points_data:
        points_dict = {
            "latitude": point["latitude"],
            "longitude": point["longitude"],
            "time": datetime.fromtimestamp(
                (point["timestamp"] * 100 + start_time)
                / 1000,  # note that the timestamp of a point is decisecond(分秒)
                tz=timezone.utc,
            ),
            "elevation": point.get("altitude"),
            "hr": point.get("hr"),
        }
        points_dict_list.append(points_dict)
    gpx = gpxpy.gpx.GPX()
    gpx.nsmap["gpxtpx"] = "http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
    gpx_track = gpxpy.gpx.GPXTrack()
    gpx_track.name = "gpx from keep"
    gpx_track.type = sport_type
    gpx.tracks.append(gpx_track)

    # Create first segment in our GPX track:
    gpx_segment = gpxpy.gpx.GPXTrackSegment()
    gpx_track.segments.append(gpx_segment)
    for p in points_dict_list:
        point = gpxpy.gpx.GPXTrackPoint(
            latitude=p["latitude"],
            longitude=p["longitude"],
            time=p["time"],
            elevation=p.get("elevation"),
        )
        if p.get("hr") is not None:
            gpx_extension_hr = ET.fromstring(
                f"""<gpxtpx:TrackPointExtension xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
                    <gpxtpx:hr>{p["hr"]}</gpxtpx:hr>
                    </gpxtpx:TrackPointExtension>
                    """
            )
            point.extensions.append(gpx_extension_hr)
        gpx_segment.points.append(point)
    return gpx


def find_nearest_hr(
    hr_data_list, target_time, start_time, threshold=HR_FRAME_THRESHOLD_IN_DECISECOND
):
    """
    Find the nearest heart rate data point to the target time.
    if cannot found suitable HR data within the specified time frame (within 10 seconds by default), there will be no hr data return
    Args:
        heart_rate_data (list of dict): A list of heart rate data points, where each point is a dictionary
            containing at least "timestamp" and "beatsPerMinute" keys.
        target_time (float): The target timestamp for which to find the nearest heart rate data point. Please Note that the unit of target_time is decisecond(分秒),
            means 1/10 of a second ,this is very unusual!! so when we convert a target_time to second we need to divide by 10, and when we convert a target time to millsecond
            we need to times 100.
        start_time (float): The reference start time. the unit of start_time is normal millisecond timestamp
        threshold (float, optional): The maximum allowed time difference to consider a data point as the nearest.
            Default is HR_THRESHOLD, the unit is decisecond(分秒)

    Returns:
        int or None: The heart rate value of the nearest data point, or None if no suitable data point is found.
    """
    closest_element = None
    # init difference value
    min_difference = float("inf")
    if target_time > TIMESTAMP_THRESHOLD_IN_DECISECOND:
        target_time = (
            target_time * 100 - start_time
        ) / 100  # note that the unit of target_time is decisecond and the unit of start_time is normal millisecond

    for item in hr_data_list:
        timestamp = item["timestamp"]
        difference = abs(timestamp - target_time)

        if difference <= threshold and difference < min_difference:
            closest_element = item
            min_difference = difference

    if closest_element:
        hr = closest_element.get("beatsPerMinute")
        if hr and hr > 0:
            return hr

    return None


def download_keep_gpx(gpx_data, keep_id):
    try:
        print(f"downloading keep_id {str(keep_id)} gpx")
        file_path = os.path.join(GPX_FOLDER, str(keep_id) + ".gpx")
        with open(file_path, "w") as fb:
            fb.write(gpx_data)
        return file_path
    except:
        print(f"wrong id {keep_id}")
        pass


def run_keep_sync(email, password, with_download_gpx=False):
    generator = Generator(SQL_FILE)
    old_tracks_ids = generator.get_old_tracks_ids()
    new_tracks = get_all_keep_tracks(
        email, password, old_tracks_ids, with_download_gpx
    )
    generator.sync_from_app(new_tracks)

    activities_list = generator.load()
    with open(JSON_FILE, "w") as f:
        json.dump(activities_list, f, indent=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phone_number", help="keep login phone number")
    parser.add_argument("password", help="keep login password")
    parser.add_argument(
        "--with-gpx",
        dest="with_gpx",
        action="store_true",
        help="get all keep data to gpx and download",
    )
    options = parser.parse_args()
    run_keep_sync(options.phone_number, options.password, options.with_gpx)
