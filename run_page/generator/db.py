import datetime
import time

import geopy
from config import TYPE_DICT
from geopy.geocoders import Nominatim
from sqlalchemy import (
    Boolean,
    Column,
    Float,
    Integer,
    Interval,
    String,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

Base = declarative_base()


# 反向地理编码（经纬度 -> 地名）相关配置
# User-Agent 需符合 Nominatim 使用政策：包含应用标识与联系方式
NOMINATIM_USER_AGENT = "workouts-log/1.0 (https://github.com/jimerun/workouts_log)"
# 两次请求之间的最小间隔（秒），遵守 Nominatim 约 1 req/s 的限制，预留裕度避免被限流
GEOCODE_MIN_INTERVAL = 1.5
# 单次请求超时（秒）
GEOCODE_TIMEOUT = 10
# 失败最大重试次数
GEOCODE_MAX_RETRIES = 3
# 重试退避基数（秒）
GEOCODE_RETRY_BACKOFF = 2.0

geopy.geocoders.options.default_user_agent = NOMINATIM_USER_AGENT
# reverse the location (lat, lon) -> location detail
# rate_limit 关闭，由下方 _throttle_geocode 统一控制请求间隔
g = Nominatim(user_agent=NOMINATIM_USER_AGENT, timeout=GEOCODE_TIMEOUT)

_last_geocode_ts = 0.0


def _throttle_geocode():
    """确保两次地理编码请求之间至少间隔 GEOCODE_MIN_INTERVAL 秒。"""
    global _last_geocode_ts
    elapsed = time.monotonic() - _last_geocode_ts
    if elapsed < GEOCODE_MIN_INTERVAL:
        time.sleep(GEOCODE_MIN_INTERVAL - elapsed)
    _last_geocode_ts = time.monotonic()


def reverse_geocode(start_point):
    """将 (lat, lon) 反向地理编码为地名字符串，带限流与重试。失败返回空串。"""
    if not start_point:
        return ""
    lat, lon = start_point.lat, start_point.lon
    last_err = None
    for attempt in range(1, GEOCODE_MAX_RETRIES + 1):
        try:
            _throttle_geocode()
            result = g.reverse(f"{lat}, {lon}", language="zh-CN")
            return str(result) if result else ""
        except Exception as e:
            last_err = e
            if attempt < GEOCODE_MAX_RETRIES:
                time.sleep(GEOCODE_RETRY_BACKOFF * attempt)
    print(f"[geocode] failed for {lat},{lon}: {last_err}")
    return ""


ACTIVITY_KEYS = [
    "run_id",
    "name",
    "distance",
    "moving_time",
    "type",
    "start_date",
    "start_date_local",
    "location_country",
    "summary_polyline",
    "average_heartrate",
    "average_speed",
    "elevation_gain",
    "calories",
    "source",
]


class Activity(Base):
    __tablename__ = "activities"

    run_id = Column(Integer, primary_key=True)
    name = Column(String)
    distance = Column(Float)
    moving_time = Column(Interval)
    elapsed_time = Column(Interval)
    type = Column(String)
    start_date = Column(String)
    start_date_local = Column(String)
    location_country = Column(String)
    start_lat = Column(Float)
    start_lon = Column(Float)
    summary_polyline = Column(String)
    average_heartrate = Column(Float)
    average_speed = Column(Float)
    elevation_gain = Column(Float)
    calories = Column(Float)
    streak = None
    source = Column(String)
    no_gps = Column(Boolean, default=False)  # 标记室内/无GPS活动，跳过地理编码

    def to_dict(self):
        out = {}
        for key in ACTIVITY_KEYS:
            attr = getattr(self, key)
            if isinstance(attr, (datetime.timedelta, datetime.datetime)):
                out[key] = str(attr)
            else:
                out[key] = attr

        if self.streak:
            out["streak"] = self.streak

        return out


def update_or_create_activity(session, run_activity):
    created = False
    try:
        activity = (
            session.query(Activity).filter_by(run_id=int(run_activity.id)).first()
        )
        type = run_activity.type
        source = run_activity.source if hasattr(run_activity, "source") else "gpx"
        if run_activity.type in TYPE_DICT:
            type = TYPE_DICT[run_activity.type]
        if not activity:
            start_point = run_activity.start_latlng
            location_country = getattr(run_activity, "location_country", "")
            # or China for #176 to fix
            if (not location_country and start_point) or location_country == "China":
                location_country = reverse_geocode(start_point)
            start_lat = start_point.lat if start_point else None
            start_lon = start_point.lon if start_point else None
            no_gps = start_point is None  # 无GPS坐标时标记，后续跳过地理编码

            activity = Activity(
                run_id=run_activity.id,
                name=run_activity.name,
                distance=run_activity.distance,
                moving_time=run_activity.moving_time,
                elapsed_time=run_activity.elapsed_time,
                type=type,
                start_date=run_activity.start_date,
                start_date_local=run_activity.start_date_local,
                location_country=location_country,
                start_lat=start_lat,
                start_lon=start_lon,
                no_gps=no_gps,
                average_heartrate=run_activity.average_heartrate,
                average_speed=float(run_activity.average_speed),
                elevation_gain=(
                    float(run_activity.elevation_gain)
                    if run_activity.elevation_gain is not None
                    else None
                ),
                summary_polyline=(
                    run_activity.map and run_activity.map.summary_polyline or ""
                ),
                calories=getattr(run_activity, "calories", None),
                source=source,
            )
            session.add(activity)
            created = True
        else:
            activity.name = run_activity.name
            activity.distance = float(run_activity.distance)
            activity.moving_time = run_activity.moving_time
            activity.elapsed_time = run_activity.elapsed_time
            activity.type = type
            activity.average_heartrate = run_activity.average_heartrate
            activity.average_speed = float(run_activity.average_speed)
            activity.elevation_gain = (
                float(run_activity.elevation_gain)
                if run_activity.elevation_gain is not None
                else None
            )
            activity.summary_polyline = (
                run_activity.map and run_activity.map.summary_polyline or ""
            )
            # source 在首次建记录时已固定，更新分支不重写
            # calories 跟随每次同步刷新（仅当该同步源提供时覆盖，避免清空其它源已写入的值）
            incoming_calories = getattr(run_activity, "calories", None)
            if incoming_calories is not None:
                activity.calories = incoming_calories
            # 即使本次不重新解析位置，也刷新起点经纬度，
            # 以便后续 backfill_location_country 能据此补全缺失的位置
            start_point = run_activity.start_latlng
            if start_point is not None:
                activity.start_lat = start_point.lat
                activity.start_lon = start_point.lon
                activity.no_gps = False  # 有坐标后清除标记
            elif activity.start_lat is None:
                activity.no_gps = True   # 从未有过坐标，标记为无GPS
    except Exception as e:
        print(f"something wrong with {run_activity.id}")
        print(str(e))

    return created


def backfill_location_country(session):
    """对库中已经存在但 location_country 为空、且有起点的记录补跑反向地理编码。

    在每次导入新文件后调用（见 generator.sync_from_data_dir），用于补全之前因为
    Nominatim 限流 / 超时 / 无网络而解析失败的记录。已标记 no_gps 的记录会被跳过。
    """
    rows = (
        session.query(Activity)
        .filter(
            (
                Activity.location_country.is_(None)
                | (Activity.location_country == "")
            )
            & Activity.start_lat.isnot(None)
            & Activity.start_lon.isnot(None)
            & (Activity.no_gps == False)
        )
        .all()
    )
    if not rows:
        print("[geocode] no missing location_country to backfill.")
        return 0

    print(
        f"[geocode] backfilling {len(rows)} activities with missing location_country ..."
    )

    class _Point:
        def __init__(self, lat, lon):
            self.lat = lat
            self.lon = lon

    updated = 0
    for idx, a in enumerate(rows, 1):
        loc = reverse_geocode(_Point(a.start_lat, a.start_lon))
        if loc:
            a.location_country = loc
            updated += 1
        if idx % 20 == 0:
            session.commit()
            print(f"[geocode] backfilled {idx}/{len(rows)} ...")
    session.commit()
    print(f"[geocode] backfill done: {updated}/{len(rows)} updated.")
    return updated


def add_missing_columns(engine, model):
    inspector = inspect(engine)
    table_name = model.__tablename__
    columns = {col["name"] for col in inspector.get_columns(table_name)}
    missing_columns = []

    for column in model.__table__.columns:
        if column.name not in columns:
            missing_columns.append(column)
    if missing_columns:
        with engine.connect() as conn:
            for column in missing_columns:
                column_type = str(column.type)
                conn.execute(
                    text(
                        f"ALTER TABLE {table_name} ADD COLUMN {column.name} {column_type}"
                    )
                )


def init_db(db_path):
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)

    # check missing columns
    add_missing_columns(engine, Activity)

    sm = sessionmaker(bind=engine)
    session = sm()
    # apply the changes
    session.commit()
    return session
