import argparse
import asyncio
import hashlib
import os
import time

import aiofiles
import httpx

from config import JSON_FILE, SQL_FILE, FOLDER_DICT
from utils import make_activities_file

COROS_URL_DICT = {
    "LOGIN_URL": "https://teamcnapi.coros.com/account/login",
    "DOWNLOAD_URL": "https://teamcnapi.coros.com/activity/detail/download",
    "ACTIVITY_LIST": "https://teamcnapi.coros.com/activity/query",
}

COROS_TYPE_DICT = {
    "gpx": 1,
    "fit": 4,
    "tcx": 3,
}


TIME_OUT = httpx.Timeout(240.0, connect=360.0)


class Coros:
    def __init__(self, account, password, is_only_running=False):
        self.account = account
        self.password = password
        self.headers = None
        self.req = None

    async def login(self):
        url = COROS_URL_DICT.get("LOGIN_URL")
        headers = {
            "authority": "teamcnapi.coros.com",
            "accept": "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9",
            "content-type": "application/json;charset=UTF-8",
            "dnt": "1",
            "origin": "https://t.coros.com",
            "referer": "https://t.coros.com/",
            "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        }
        data = {"account": self.account, "accountType": 2, "pwd": self.password}
        async with httpx.AsyncClient(timeout=TIME_OUT) as client:
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
            # self.is_only_running = is_only_running  # 死代码，从未被读取，会导致 NameError
        # 复用已有的异步 client 并刷新其请求头，而不是新建一个（避免连接泄漏），
        # 这样 login() 可以在会话中途用来续期已过期的 token。
        if self.req is None:
            self.req = httpx.AsyncClient(timeout=TIME_OUT, headers=self.headers)
        else:
            self.req.headers.update(self.headers)

    async def init(self):
        await self.login()

    async def _refresh_token(self):
        """重新登录以续期 access token；成功返回 True。"""
        try:
            await self.login()
            return True
        except Exception as exc:
            print(f"Failed to refresh COROS token: {exc}")
            return False

    async def fetch_activity_ids_types(self, only_run):
        page_number = 1
        all_activities_ids_types = []

        mode_list_str = "100,101,102,103" if only_run else ""
        while True:
            url = f"{COROS_URL_DICT.get('ACTIVITY_LIST')}?&modeList={mode_list_str}&pageNumber={page_number}&size=20"
            response = await self.req.get(url)
            data = response.json()
            activities = data.get("data", {}).get("dataList", None)
            if not activities:
                break
            for activity in activities:
                label_id = activity["labelId"]
                sport_type = activity["sportType"]
                if label_id is None:
                    continue
                all_activities_ids_types.append([label_id, sport_type])

            page_number += 1

        return all_activities_ids_types

    async def download_activity(self, label_id, sport_type, file_type, max_retries=3):
        if sport_type == 101 and file_type == "gpx":
            print(
                f"Sport type {sport_type} is not supported in {file_type} file. The activity will be ignored"
            )
            return None, None
        download_folder = FOLDER_DICT[file_type]
        download_url = (
            f"{COROS_URL_DICT.get('DOWNLOAD_URL')}?labelId={label_id}&sportType={sport_type}"
            f"&fileType={COROS_TYPE_DICT[file_type]}"
        )
        file_url = None
        fname = ""
        file_path = ""
        # 重试循环：应对 token 过期（401）以及大文件下载时常见的
        # 网络/超时等瞬时错误。
        for attempt in range(max_retries):
            try:
                response = await self.req.post(download_url)
                if response.status_code == 401:
                    print(f"Token expired for label_id {label_id}, refreshing (retry {attempt + 1})")
                    if not await self._refresh_token():
                        break
                    continue
                resp_json = response.json()
                file_url = resp_json.get("data", {}).get("fileUrl")
                if not file_url:
                    print(f"No file URL found for label_id {label_id}")
                    return None, None

                fname = os.path.basename(file_url)
                file_path = os.path.join(download_folder, fname)

                # 大文件使用更长的读取超时；必要时会先刷新 token
                stream_timeout = httpx.Timeout(600.0, connect=360.0)
                async with self.req.stream("GET", file_url, timeout=stream_timeout) as stream_resp:
                    stream_resp.raise_for_status()
                    async with aiofiles.open(file_path, "wb") as f:
                        async for chunk in stream_resp.aiter_bytes():
                            await f.write(chunk)
                return label_id, fname
            except httpx.HTTPStatusError as exc:
                status = getattr(exc.response, "status_code", None)
                print(f"HTTP {status} error downloading {file_url}: {exc}")
                # 仅在鉴权错误（401）时刷新 token 并重试
                if status == 401 and attempt < max_retries - 1:
                    if not await self._refresh_token():
                        break
                    continue
                break
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                # 瞬时网络/超时错误（大文件常见）-> 重试
                print(f"Transient error downloading {file_url} (attempt {attempt + 1}): {exc}")
                if attempt < max_retries - 1:
                    if not await self._refresh_token():
                        break
                    continue
                break
            except Exception as exc:
                print(f"Error occurred while downloading {file_url}: {exc}")
                break
        # 清理任何只下载了部分的（损坏的）文件
        if file_path and os.path.exists(file_path):
            print(f"Delete the corrupted fit file: {fname}")
            os.remove(file_path)

        return None, None


def get_downloaded_ids(folder):
    return [i.split(".")[0] for i in os.listdir(folder) if not i.startswith(".")]


async def download_and_generate(account, password, only_run, file_type):
    folder = FOLDER_DICT[file_type]
    downloaded_ids = get_downloaded_ids(folder)
    coros = Coros(account, password)
    await coros.init()
    activity_infos = await coros.fetch_activity_ids_types(only_run=only_run)
    activity_ids = [i[0] for i in activity_infos]
    activity_types = [i[1] for i in activity_infos]
    activity_id_type_dict = dict(zip(activity_ids, activity_types))
    print("activity_ids: ", len(activity_ids))
    print("downloaded_ids: ", len(downloaded_ids))
    to_generate_coros_ids = list(set(activity_ids) - set(downloaded_ids))
    print("to_generate_activity_ids: ", len(to_generate_coros_ids))

    start_time = time.time()
    await gather_with_concurrency(
        10,
        [
            coros.download_activity(
                label_id, activity_id_type_dict[label_id], file_type
            )
            for label_id in to_generate_coros_ids
        ],
    )
    print(f"Download finished. Elapsed {time.time()-start_time} seconds")
    await coros.req.aclose()
    make_activities_file(SQL_FILE, folder, JSON_FILE, file_type, source="coros")


async def gather_with_concurrency(n, tasks):
    semaphore = asyncio.Semaphore(n)

    async def sem_task(task):
        async with semaphore:
            return await task

    return await asyncio.gather(*(sem_task(task) for task in tasks))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("account", nargs="?", help="input coros account")

    parser.add_argument("password", nargs="?", help="input coros password")

    parser.add_argument(
        "--only-run",
        dest="only_run",
        action="store_true",
        help="if is only for running",
    )

    parser.add_argument(
        "--tcx",
        dest="download_file_type",
        action="store_const",
        const="tcx",
        default="fit",
        help="to download personal documents or ebook",
    )
    parser.add_argument(
        "--gpx",
        dest="download_file_type",
        action="store_const",
        const="gpx",
        default="fit",
        help="to download personal documents or ebook",
    )
    options = parser.parse_args()

    account = options.account
    password = options.password
    is_only_running = options.only_run
    file_type = options.download_file_type
    file_type = file_type if file_type in ["gpx", "tcx", "fit"] else "fit"
    encrypted_pwd = hashlib.md5(password.encode()).hexdigest()

    asyncio.run(
        download_and_generate(account, encrypted_pwd, is_only_running, file_type)
    )
