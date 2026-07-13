r"""
coros_api_sync.py — 纯 API 方式同步 COROS 运动数据（与 FIT 解析完全独立）

本脚本不下载、不解析任何 .fit / .gpx / .tcx 文件，仅通过
`activity/detail/query` JSON 接口直接获取轨迹与统计，并写入与
原 run_page 站点共用的 data.db / activities.json。

与 coros_sync.py 的区别：
  - 不依赖 coros_sync.py（独立自包含 Coros 客户端）
  - 不做 FIT 兜底下载
  - 单位换算已通过交叉检查坐实：
        distance  : COROS 返回 厘米(cm) -> 米(m)，÷100
        avgSpeed  : 不直接使用（单位随运动类型变化）；average_speed 统一用
                    distance(m)/moving_time(s) 计算为 m/s，与全仓库约定一致
        elevGain  : 米(m)，无需换算
        startTimestamp/endTimestamp : 1/10 秒 -> ÷100
        timezone  : UTC 偏移，以「15 分钟」为单位（实测 32 = 480min = UTC+8）；
                    start_date_local = start_utc + timezone*15min，无需坐标反查
        workoutTime : 1/10 秒 -> ÷100（与 FIT 的 moving_time 一致）

用法：
    cd run_page
    python coros_api_sync.py <账号> <密码>
    python coros_api_sync.py <账号> <密码> --only-run
"""
import argparse
import asyncio
import hashlib
import json
import sys
import time
from collections import namedtuple
from datetime import datetime, timedelta, timezone

import httpx
import polyline

from config import (
    JSON_FILE,
    SQL_FILE,
    start_point,
    run_map,
)
from generator import Generator
from generator.db import update_or_create_activity, backfill_location_country
from gpxtrackposter.utils import parse_datetime_to_local

COROS_URL_DICT = {
    "LOGIN_URL": "https://teamcnapi.coros.com/account/login",
    "ACTIVITY_LIST": "https://teamcnapi.coros.com/activity/query",
    "DETAIL_QUERY_URL": "https://teamcnapi.coros.com/activity/detail/query",
}

# COROS sportType(数字) -> config.TYPE_DICT 的规范键。
# 数字编码依据开源反向工程项目 xballoy/coros-api 的 src/coros/sport-type.ts 枚举（含单元测试）。
# 这些规范键最终在 generator/db.py 经 TYPE_DICT 再映射成展示名。
COROS_SPORT_TYPE_DICT = {
    # 跑步
    100: "running",        # run 户外跑
    101: "running",        # indoorRun 室内跑
    102: "trail_running",  # trailRun 越野跑
    103: "running",        # trackRun 田径场跑
    # 徒步 / 登山 / 攀爬
    104: "hiking",         # hike 徒步
    105: "mountaineering", # mtnClimb 登山
    106: "climbing",       # climb 攀爬
    # 骑行
    200: "cycling",        # bike 户外骑行
    201: "indoor_cycling", # indoorBike 室内骑行
    202: "cycling",        # roadEbike 公路电助
    203: "cycling",        # gravelRoadBike 砾石路骑行
    204: "Mountain Bike",  # mountainRiding 山地骑行
    205: "cycling",        # mountainEbike 山地电助
    299: "cycling",        # helmetBike 头盔骑行
    # 游泳
    300: "Pool Swim",      # poolSwim 泳池游泳
    301: "Open Water",     # openWater 开放水域
    # 健身 / 有氧 / 力量
    400: "training",       # gymCardio 健身有氧
    401: "training",       # gpsCardio GPS 有氧
    402: "training",       # strength 力量训练
    # 雪上运动
    500: "Ski",            # ski 滑雪
    501: "Snowboard",      # snowboard 单板
    502: "Ski",            # xcSki 越野滑雪
    503: "Ski",            # skiTouring 滑雪登山
    # 水上运动
    700: "rowing",         # row 划船
    701: "rowing",         # indoorRow 室内划船
    702: "kayaking",       # whitewater 白水
    704: "kayaking",       # flatwater 静水
    705: "training",       # windsurfing 风帆
    706: "training",       # speedsurfing 速度冲浪
    # 攀岩
    800: "climbing",       # indoorClimb 室内攀岩
    801: "climbing",       # bouldering 抱石
    # 步行 / 其他
    900: "walking",        # walk 步行
    901: "training",       # jumpRope 跳绳
    902: "training",       # climbStairs 爬楼梯
    98:  "training",       # customSport 自定义
    # 综合 / 多项目
    10000: "triathlon",    # triathlon 铁人三项
    10001: "multisport",   # multiSport 多项运动
    10002: "Ski",          # skiTouringOld 旧版滑雪登山
    10003: "climbing",     # multiPitch 多段攀岩
}

# activity/query 列表接口返回的 sportType（与 detail 接口语义一致）
DETAIL_QUERY_TIMEOUT = httpx.Timeout(120.0, connect=360.0)
LOGIN_TIMEOUT = httpx.Timeout(240.0, connect=360.0)

CorosActivity = namedtuple(
    "CorosActivity",
    [
        "id",
        "name",
        "type",
        "distance",
        "moving_time",
        "elapsed_time",
        "start_date",
        "start_date_local",
        "location_country",
        "average_heartrate",
        "average_speed",
        "elevation_gain",
        "map",
        "start_latlng",
        "source",
    ],
)


class Coros:
    """自包含的 COROS API 客户端（仅用于 detail/query，不碰 FIT 下载）。"""

    def __init__(self, account, password):
        self.account = account
        self.password = password
        self.headers = None
        self.req = None

    async def login(self):
        url = COROS_URL_DICT["LOGIN_URL"]
        headers = {
            "authority": "teamcnapi.coros.com",
            "accept": "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9",
            "content-type": "application/json;charset=UTF-8",
            "dnt": "1",
            "origin": "https://t.coros.com",
            "referer": "https://t.coros.com/",
            "user-agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        }
        data = {"account": self.account, "accountType": 2, "pwd": self.password}
        async with httpx.AsyncClient(timeout=LOGIN_TIMEOUT) as client:
            response = await client.post(url, json=data, headers=headers)
            resp_json = response.json()
            access_token = resp_json.get("data", {}).get("accessToken")
            if not access_token:
                raise Exception(
                    "============Login failed! please check your account and password==========="
                )
            self.headers = {
                "accesstoken": access_token,
                "cookie": f"CPL-coros-region=2; CPL-coros-token={access_token}",
            }

        if self.req is None:
            self.req = httpx.AsyncClient(timeout=DETAIL_QUERY_TIMEOUT, headers=self.headers)
        else:
            self.req.headers.update(self.headers)

    async def init(self):
        await self.login()

    async def _refresh_token(self):
        try:
            await self.login()
            return True
        except Exception as exc:
            print(f"Failed to refresh COROS token: {exc}")
            return False

    async def fetch_activity_ids_types(self, only_run):
        """翻页拉取全部活动的 (labelId, sportType)。"""
        page_number = 1
        all_items = []
        mode_list_str = "100,101,102,103" if only_run else ""
        while True:
            url = (
                f"{COROS_URL_DICT['ACTIVITY_LIST']}"
                f"?&modeList={mode_list_str}&pageNumber={page_number}&size=20"
            )
            response = await self.req.get(url)
            data = response.json()
            activities = data.get("data", {}).get("dataList", None)
            if not activities:
                break
            for activity in activities:
                label_id = activity.get("labelId")
                sport_type = activity.get("sportType")
                if label_id is None:
                    continue
                all_items.append([label_id, sport_type])
            page_number += 1
        return all_items

    async def fetch_activity_detail(self, label_id, sport_type, max_retries=3):
        """调用 activity/detail/query 获取单条活动的轨迹与统计。"""
        url = (
            f"{COROS_URL_DICT['DETAIL_QUERY_URL']}"
            f"?screenW=1088&screenH=1440&labelId={label_id}&sportType={sport_type}"
        )
        for attempt in range(max_retries):
            try:
                response = await self.req.post(url, headers=self.headers)
                if response.status_code == 401:
                    print(f"[warn] token expired for {label_id}, refreshing "
                          f"(retry {attempt + 1})")
                    if not await self._refresh_token():
                        break
                    continue
                resp_json = response.json()
                if "data" not in resp_json or not resp_json.get("data"):
                    print(f"[warn] label {label_id}: empty detail -> "
                          f"{resp_json.get('message')}")
                    return None
                return resp_json
            except httpx.HTTPStatusError as exc:
                status = getattr(exc.response, "status_code", None)
                if status == 401 and attempt < max_retries - 1:
                    if not await self._refresh_token():
                        break
                    continue
                print(f"[error] detail query HTTP {status} for {label_id}: {exc}")
                break
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                print(f"[warn] transient error for {label_id} (attempt {attempt + 1}): {exc}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                break
            except Exception as exc:
                print(f"[error] detail query failed for {label_id}: {exc}")
                break
        return None


def build_coros_activity_namedtuple(detail, sport_type):
    """把 detail/query 的 JSON 构造为 update_or_create_activity 所需的命名元组。"""
    data = detail["data"]
    summary = data.get("summary", {}) or {}
    freq = data.get("frequencyList", []) or []
    pause_list = data.get("pauseList", []) or []

    # 1) 轨迹点 + 起点（首个非零坐标）
    pts = []
    start_lat = start_lon = None
    for p in freq:
        lat = p.get("gpsLat", 0) or 0
        lon = p.get("gpsLon", 0) or 0
        if lat and lon:
            dlat, dlon = lat / 1e7, lon / 1e7
            pts.append([dlat, dlon])
            if start_lat is None:
                start_lat, start_lon = dlat, dlon

    polyline_str = polyline.encode(pts) if pts else ""
    start_point_obj = (
        start_point(start_lat, start_lon) if start_lat is not None else None
    )

    # 2) 时间（startTimestamp/endTimestamp 为 1/10 秒）
    start_ts = summary.get("startTimestamp", 0) or 0
    end_ts = summary.get("endTimestamp", start_ts) or start_ts
    start_utc = datetime.fromtimestamp(start_ts / 100, tz=timezone.utc)
    end_utc = datetime.fromtimestamp(end_ts / 100, tz=timezone.utc)

    # start_date_local：优先用官方 summary.timezone 字段。
    # COROS 以「15 分钟」为单位编码 UTC 偏移（实测 32 => 32*15min = 480min = UTC+8），
    # 直接换算即可：无需坐标反查、对无 GPS 的室内活动也准确、且反映活动当时的真实
    # 偏移（自动正确处理跨夏令时的历史活动，不像 parse_datetime_to_local 用 now() 取偏移）。
    raw_tz = summary.get("timezone")
    if raw_tz:
        start_local = start_utc + timedelta(minutes=int(raw_tz) * 15)
    else:
        # 兜底：官方字段缺失时才退回到坐标反查（依赖 tzfpy，且 DST 用 now() 会有偏差）
        start_local, _ = parse_datetime_to_local(
            start_utc,
            end_utc,
            (start_lat, start_lon) if start_lat is not None else None,
        )

    # elapsed_time：优先用 summary.totalTime（总经过时间，含暂停，单位 1/10 秒），
    # 缺失时再回退到 endTimestamp - startTimestamp 相减。
    total_time = summary.get("totalTime", 0) or 0
    if total_time:
        elapsed_sec = total_time / 100.0
    else:
        elapsed_sec = (end_ts - start_ts) / 100.0

    # 3) moving_time：workoutTime/100（已与 FIT 交叉检查一致）
    workout_time = summary.get("workoutTime", 0) or 0
    moving_sec = workout_time / 100.0

    # 4) 运动类型：COROS_SPORT_TYPE_DICT 已产出 config.TYPE_DICT 的合法键，
    # 由 generator/db.py 统一归一化成展示名，无需再做白名单过滤。
    raw_sport = summary.get("sportType", sport_type)
    if raw_sport in COROS_SPORT_TYPE_DICT:
        type_str = COROS_SPORT_TYPE_DICT[raw_sport]
    else:
        print(f"[warn] unknown COROS sportType={raw_sport}, fallback to training")
        type_str = "training"

    # 5) 单位换算（已坐实）
    distance_raw = float(summary.get("distance", 0) or 0)
    distance = distance_raw / 100.0
    avg_hr = summary.get("avgHr")
    # average_speed：统一为标准单位 m/s。
    # 不直接用 summary.avgSpeed——其单位随运动类型变化（跑步为 s/km，
    # 其余为 km/h×100），需逐条猜单位。改用已由已知单位字段算出的
    # distance(m) / moving_time(s)，天然为 m/s，且对所有运动类型一致，
    # 与全仓库其他同步源（garmin/keep/codoon…）的 average_speed 约定(m/s) 统一。
    average_speed = (distance / moving_sec) if (moving_sec and distance) else 0.0
    elev_gain = summary.get("elevGain", 0) or 0
    name = summary.get("name", "") or ""

    run_id = int(start_ts * 10)  # 与 FIT 的 POSIX_sec*1000 同源，避免主键冲突

    return CorosActivity(
        id=run_id,
        name=name,
        type=type_str,
        distance=distance,
        moving_time=timedelta(seconds=moving_sec),
        elapsed_time=timedelta(seconds=elapsed_sec),
        start_date=start_utc.strftime("%Y-%m-%d %H:%M:%S"),
        start_date_local=start_local.strftime("%Y-%m-%d %H:%M:%S"),
        location_country="",  # 由 backfill_location_country 反查补全
        average_heartrate=int(avg_hr) if avg_hr else None,
        average_speed=float(average_speed),
        elevation_gain=float(elev_gain) if elev_gain else 0.0,
        map=run_map(polyline_str),
        start_latlng=start_point_obj,
        source="coros",
    )


async def sync_via_api(account, password, only_run):
    coros = Coros(account, password)
    await coros.init()

    gen = Generator(SQL_FILE)
    items = await coros.fetch_activity_ids_types(only_run=only_run)
    print(f"Fetched {len(items)} activities from COROS API")

    new_count = 0
    updated_count = 0
    for label_id, sport_type in items:
        try:
            detail = await coros.fetch_activity_detail(label_id, sport_type)
            if not detail:
                continue
            nt = build_coros_activity_namedtuple(detail, sport_type)
            created = update_or_create_activity(gen.session, nt)
            if created:
                sys.stdout.write("+")
                new_count += 1
            else:
                sys.stdout.write(".")
                updated_count += 1
            sys.stdout.flush()
        except Exception as e:
            print(f"\n[error] label {label_id}: {e}")

    gen.session.commit()
    # 补全此前因限流/无网而缺失的位置信息（与原 FIT 流程一致）
    backfill_location_country(gen.session)

    activities_list = gen.load()
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(activities_list, f, indent=0, ensure_ascii=False)

    print(f"\nDone: {new_count} new, {updated_count} updated. "
          f"Wrote {len(activities_list)} activities -> {JSON_FILE}")
    await coros.req.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Sync COROS activities via API only (no FIT parsing)."
    )
    parser.add_argument("account", nargs="?", help="COROS account")
    parser.add_argument("password", nargs="?", help="COROS password")
    parser.add_argument(
        "--only-run",
        dest="only_run",
        action="store_true",
        help="only sync running activities",
    )
    options = parser.parse_args()

    account = options.account
    password = options.password
    if not account or not password:
        parser.error("account and password are required")

    encrypted_pwd = hashlib.md5(password.encode()).hexdigest()
    start_time = time.time()
    asyncio.run(sync_via_api(account, encrypted_pwd, options.only_run))
    print(f"Total elapsed {time.time() - start_time:.1f} seconds")
