"""检查 COROS FIT 文件的 record_mesgs 字段名"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from garmin_fit_sdk import Decoder, Stream

FIT_OUT = os.path.join(os.path.dirname(__file__), '..', 'FIT_OUT')
files = sorted([f for f in os.listdir(FIT_OUT) if f.endswith('.fit') if os.path.exists(os.path.join(FIT_OUT, f))])
print(f"FIT 文件总数: {len(files)}")

# 抽查前 5 个有 GPS 的文件
checked = 0
for fname in files:
    if checked >= 5:
        break
    fpath = os.path.join(FIT_OUT, fname)
    try:
        stream = Stream.from_file(fpath)
        decoder = Decoder(stream)
        messages, errors = decoder.read(convert_datetimes_to_dates=False)

        record_mesgs = messages.get('record_mesgs', [])
        has_position = any("position_lat" in r for r in record_mesgs)
        has_gps = any("latitude" in r or "longitude" in r for r in record_mesgs)

        # 列出 record_mesgs 第一条的所有字段名
        sample_keys = list(record_mesgs[0].keys()) if record_mesgs else []

        # 搜索所有包含 lat/lon/pos 的字段名
        lat_lon_fields = set()
        for r in record_mesgs:
            for k in r:
                kl = k.lower()
                if 'lat' in kl or 'lon' in kl or 'pos' in kl:
                    lat_lon_fields.add(k)

        print(f"\n{fname}:")
        print(f"  record 数量: {len(record_mesgs)}")
        print(f"  有 position_lat/position_long: {has_position}")
        print(f"  有 latitude/longitude: {has_gps}")
        print(f"  坐标相关字段: {sorted(lat_lon_fields)}")
        print(f"  record_mesgs 首条字段: {sample_keys}")

        session = messages.get('session_mesgs', [{}])[0]
        sport = session.get('sport', '?')
        print(f"  sport: {sport}")

        checked += 1
    except Exception as e:
        print(f"\n{fname}: ERROR {e}")
