# 通过 sub2api 调用 Kling API

更新日期：2026-11-19。本文针对当前部署的二开 sub2api，以及其后面的 kling-multi 账号池反代。以第三方应用调用视频生成为主。

## 1. 调用地址与密钥

调用链：

```text
你的程序 → sub2api → kling-multi → Kling 网页通道 / 官方 CLI
           8080        8020
```

| 项目 | 当前使用方式 |
| --- | --- |
| sub2api 服务地址 | `https://api.example.com`，已有站点域名时可换成对应域名 |
| Kling 接口前缀 | `/kling/v1` |
| 客户端凭据 | 在 **sub2api 的 API Key 页面**创建、绑定 Kling 分组的用户 API Key |
| 请求头 | `Authorization: Bearer <SUB2API_API_KEY>` |
| 请求格式 | `Content-Type: application/json` |

调用方直接使用 sub2api API Key。sub2api 负责生成上游 Kling JWT；不需要给调用方提供 Kling Access Key / Secret Key、账号密码、CLI 授权文件或反代管理 Key。

下面所有示例中，`SUB2API_URL` **仅填站点根地址**，不包含 `/kling` 或 `/v1`，完整接口路径由示例拼接。

```bash
export SUB2API_URL='https://api.example.com'
export SUB2API_API_KEY='替换成你在sub2api创建的API_Key'
```

业务程序应在自己的服务端保存 API Key。

### 管理员需要先配置什么

1. 在 sub2api 创建平台为 **Kling** 的上游账号，Base URL 填 `http://kling-relay:8020`。
2. 上游账号凭据使用反代的 `Access Key|Secret Key`，由管理员保存；这串值不是发给下游用户的 API Key。
3. 将该账号加入 Kling 分组，开启该分组的生图权限开关。当前实现也通过这个开关控制视频生成权限。
4. 按实际能力同步并放行模型，配置视频模型价格、分辨率档位和分组倍率。
5. 用户创建 API Key 并绑定该 Kling 分组，确保额度、订阅或余额满足调用条件。

外部调用的分组由 API Key 决定。`X-Video-Studio-Group` 是网页工作台选择分组的机制，不能用它替换普通 API Key 的分组绑定。

## 2. 最小调用流程

1. POST 提交一次任务，保存返回的 `data.task_id`。
2. 每隔 5–10 秒，用同一 API Key 查询对应任务。
3. 当 `data.task_status` 为 `succeed` 时，读取 `data.task_result.videos[].url`。
4. 下载并保存视频结果。

提交成功只表示取得任务回执，视频生成仍然是异步的。提交接口自身需要等待上游接单、素材准备等步骤，示例设置了 180 秒 HTTP 超时。

### 2.1 创建一个 3 秒 Flash 视频

先保存请求正文，后续也方便核对业务记录：

```bash
cat > request.json <<'JSON'
{
  "model_name": "kling-v4-flash",
  "prompt": "一只橘猫坐在窗边，镜头缓慢推进，自然光，动作平稳",
  "duration": 3,
  "mode": "std",
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "sound": "off",
  "channel": "auto"
}
JSON

# 每个新任务创建一个新编号，并将其与请求正文一起保存在你的业务记录中。
REQUEST_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"
printf '%s\n' "$REQUEST_KEY" > request-key.txt

curl --fail-with-body --silent --show-error \
  --connect-timeout 10 --max-time 180 \
  "$SUB2API_URL/kling/v1/videos/text2video" \
  -H "Authorization: Bearer $SUB2API_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $REQUEST_KEY" \
  --data-binary @request.json \
  --output submit-response.json

cat submit-response.json
```

成功响应示意，编号和时间为示例值：

```json
{
  "code": 0,
  "message": "",
  "request_id": "example-request-id",
  "data": {
    "task_id": "example-task-id",
    "task_status": "submitted",
    "task_status_msg": "",
    "created_at": 1795046400000,
    "updated_at": 1795046400000,
    "task_result": {"videos": []}
  }
}
```

保存的是 **`data.task_id`**，顶层 `request_id` 用于请求排查，不能代替任务编号。

### 2.2 查询任务

```bash
TASK_ID="$(python3 -c 'import json; print(json.load(open("submit-response.json"))["data"]["task_id"])')"

curl --fail-with-body --silent --show-error \
  --connect-timeout 10 --max-time 60 \
  "$SUB2API_URL/kling/v1/videos/text2video/$TASK_ID" \
  -H "Authorization: Bearer $SUB2API_API_KEY"
```

图生视频的任务使用 `/kling/v1/videos/image2video/{task_id}` 查询。建议在自己的业务记录中同时保存创建接口种类、任务编号、API Key 标识和所属分组。

生成成功的 `data` 示意：

```json
{
  "task_id": "example-task-id",
  "task_status": "succeed",
  "task_status_msg": "",
  "created_at": 1795046400000,
  "updated_at": 1795046460000,
  "task_result": {
    "videos": [
      {
        "id": "example-video-id",
        "url": "https://your-video-cdn.example.com/result.mp4",
        "duration": "3"
      }
    ]
  }
}
```

`task_result.videos` 是数组，按数组读取。结果 URL 应及时下载保存，不应当作永久素材地址。

```bash
VIDEO_URL='替换成task_result.videos中的真实url'
curl --fail --location --output result.mp4 "$VIDEO_URL"
```

下载结果 CDN 链接时，无需附带 sub2api API Key。

## 3. 当前可用的接口

本节均以 sub2api 根地址为起点。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/kling/v1/models` | 查询 sub2api 的 Kling 模型目录 |
| POST | `/kling/v1/videos/text2video` | 文生视频 |
| POST | `/kling/v1/videos/image2video` | 首尾帧、关键帧或全能参考视频 |
| GET | `/kling/v1/videos/text2video/{task_id}` | 查询文生视频 |
| GET | `/kling/v1/videos/image2video/{task_id}` | 查询图生视频/全能参考视频 |
| POST | `/kling/v1/images/generations` | 图像生成，需配置对应图像模型与权限 |
| GET | `/kling/v1/images/generations/{task_id}` | 查询图像任务 |

注意以下路径区别：

- 不要将 sub2api 路径写成反代直连的 `/v1/videos/text2video`，应加上 `/kling` 前缀。
- sub2api 的 `/v1/videos` 不是当前 Kling 对外接入入口。
- 不要把 Kling 生成请求发到 `/v1/chat/completions`。
- 当前 sub2api 没有注册 `/kling/v1/videos/{task_id}` 这个通用查询入口；应使用表中的对应任务查询路径。

模型目录的请求示例：

```bash
curl --fail-with-body --silent --show-error \
  "$SUB2API_URL/kling/v1/models" \
  -H "Authorization: Bearer $SUB2API_API_KEY"
```

这个接口返回 OpenAI 风格的 `{"object":"list","data":[...]}` 模型目录。**当前实现是静态兼容目录，不是账号池实时能力查询，也不是分组完整能力声明**。列表包含某模型不代表该 Key 的分组一定允许调用，更不代表所有素材组合都可用。

### 4.0 专用入口

sub2api 还注册了：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/kling/v1/text-to-video/kling-4.0` | 4.0 专用文生视频格式 |
| POST | `/kling/v1/image-to-video/kling-4.0` | 4.0 专用首尾帧格式 |
| GET | `/kling/v1/tasks/{task_id}` | 查询 4.0 专用格式创建的任务 |
| GET | `/kling/v1/tasks?task_ids={task_id}` | 同上；当前 sub2api 实际只取一个任务编号 |

专用入口与传统接口的请求、响应格式不同，例如使用 `settings`、`contents`，响应使用 `data.id` / `data.status` / `outputs`；不要混用两套正文和查询解析方式。

`/kling/v1/omni-video/kling-4.0` 虽在 sub2api 注册，但当前后端 kling-multi 未实现对应上游路径。**本部署接入全能参考应使用 `videos/image2video` + `video_mode: reference`。**

本文示例统一使用传统兼容格式，便于切换 4.0、Flash 和 Omni 模型。

## 4. 视频模型与参数

建议显式传 `model_name`。传统视频接口省略它时仍默认 `kling-v1`，不适合作为当前项目的默认调用方式。这里使用的是 Kling 的 `model_name` 字段，不是 OpenAI 的 `model` 字段。

| 常用模型 | 说明 | 当前参考时长 |
| --- | --- | --- |
| `kling-v4-flash` | 4.0 Flash；建议先用 `3 秒 + std + 720p` 接通流程 | 3–20 秒 |
| `kling-v4` | 4.0；支持首尾帧及全能参考，取决于通道 | 3–30 秒 |
| `kling-v3-omni` | 3.0 Omni；素材组合、音频和分辨率有额外限制 | 3–15 秒 |
| `kling-v3` | 3.0；由账号实际通道能力决定是否可用 | 3–15 秒 |

以上为当前项目能力快照。实际上游、账号权限和通道声明可能进一步缩小支持范围；以实际返回为准。

| 字段 | 类型 | 使用方式 |
| --- | --- | --- |
| `model_name` | string | 显式填写上述模型 ID |
| `prompt` | string | 最多 2500 字符；文生视频必填，图生视频也建议填写 |
| `duration` | integer / string | 正整数秒数，例如 `3` 或 `"3"`，默认 5 |
| `mode` | string | `std` / `pro`，默认 `std`；Flash 用 `std` |
| `resolution` | string | `720p` / `1080p` / `4k`，由模型和通道限制；Flash 当前用 `720p` |
| `aspect_ratio` | string | 文生视频如 `16:9`、`9:16`、`1:1`；首尾帧可省略；全能参考的 `auto` 需要图像或视频素材 |
| `sound` | string | `on` / `off`；示例默认关闭生成音频 |
| `enable_audio` | boolean | 音频开关的另一种写法；与 `sound` 同传时必须一致 |
| `channel` | string | `auto` / `browser` / `paid`，建议使用 `auto` |
| `image` | string | 普通首帧 URL 或图片 Base64，用于 `image2video` |
| `image_tail` | string | 普通尾帧；不要默认 Flash 也支持尾帧 |
| `video_mode` | string | `frames` / `reference`；全能参考必填 `reference` |
| `reference_images` | array | 图片槽位 `{name,url}` 数组，与 `image` / `image_tail` 二选一 |
| `reference_media` | array | 全能参考的视频、音频槽位 `{name,url}` |
| `keep_original_sound` | boolean | 保留参考视频原声，要求有视频素材，且不能同时生成音频 |
| `prefer_multi_shots` | boolean | 智能分镜；网页 4.0 / Flash 全能参考当前需要 `true` |
| `negative_prompt` | string | 负向提示词，可选，模型支持时才传 |
| `cfg_scale` | number | 0–1，可选，模型支持时才传 |

`mode: pro` 不要和 `720p` 组合；需要专业模式时选择支持它的模型及匹配的分辨率。没有明确需求时，先使用示例的 `std + 720p`。

## 5. 图生视频示例

以下正文均 POST 到：

```text
/kling/v1/videos/image2video
```

可以将某个 JSON 示例保存成 `image-request.json` 后提交：

```bash
REQUEST_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"
curl --fail-with-body --silent --show-error \
  --connect-timeout 10 --max-time 180 \
  "$SUB2API_URL/kling/v1/videos/image2video" \
  -H "Authorization: Bearer $SUB2API_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $REQUEST_KEY" \
  --data-binary @image-request.json
```

示例素材地址必须替换为自己的真实公开素材链接。

### 5.1 首帧图：Flash，3 秒

```json
{
  "model_name": "kling-v4-flash",
  "prompt": "保持首帧人物的外貌与服装，人物轻轻转头，镜头平稳",
  "image": "https://your-cdn.example.com/first.png",
  "duration": 3,
  "mode": "std",
  "resolution": "720p",
  "sound": "off",
  "channel": "auto"
}
```

普通 `image` 对应首帧。需要固定第一帧时使用这种方式；全能参考中的 `image_1` 是参考素材，不能当作固定首帧。

### 5.2 首帧 + 尾帧：4.0

```json
{
  "model_name": "kling-v4",
  "prompt": "从首帧自然过渡到尾帧，保持人物和场景一致",
  "image": "https://your-cdn.example.com/first.png",
  "image_tail": "https://your-cdn.example.com/last.png",
  "duration": 5,
  "mode": "std",
  "resolution": "720p",
  "sound": "off"
}
```

首尾帧示例省略了 `aspect_ratio`，让模型按输入画面及通道规则处理。

### 5.3 全能参考：人物 + 场景

```json
{
  "model_name": "kling-v4-flash",
  "prompt": "使用图片1中的人物和服装，在图片2中的街道缓慢行走，保持人物外貌一致",
  "video_mode": "reference",
  "reference_images": [
    {"name": "image_1", "url": "https://your-cdn.example.com/person.png"},
    {"name": "image_2", "url": "https://your-cdn.example.com/street.png"}
  ],
  "duration": 3,
  "mode": "std",
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "sound": "off",
  "prefer_multi_shots": true,
  "channel": "auto"
}
```

### 5.4 全能参考：图片 + 视频，保留视频原声

```json
{
  "model_name": "kling-v4",
  "prompt": "使用图片1中的人物，参考视频1中的动作与镜头运动",
  "video_mode": "reference",
  "reference_images": [
    {"name": "image_1", "url": "https://your-cdn.example.com/person.png"}
  ],
  "reference_media": [
    {"name": "video_1", "url": "https://your-cdn.example.com/motion.mp4"}
  ],
  "duration": 5,
  "mode": "std",
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "sound": "off",
  "keep_original_sound": true,
  "prefer_multi_shots": true,
  "channel": "auto"
}
```

这里 `sound: off` 关闭的是模型生成音频，`keep_original_sound: true` 保留参考视频原声，两者不冲突。没有视频素材时不要传 `keep_original_sound: true`。

### 素材格式与槽位

| 参考模式 | 素材槽位 |
| --- | --- |
| 首尾帧 / 关键帧 | `input`、`tail_image`、`keyframe_1`、`keyframe_2`… |
| 全能参考图片 | `image_1`、`image_2`… |
| 全能参考视频 | `video_1`、`video_2`… |
| 全能参考音频 | `audio_1`、`audio_2`… |

素材条目统一为 `{"name":"槽位名","url":"素材地址或图片Base64"}`。槽位不能重复；按实际模型支持的数量和类型提供。不要额外附加 `duration` 等媒体条目字段，参考视频时长由服务端核验。

- 图片支持公开 HTTP(S) URL、原始 Base64 或 `data:image/...;base64,...`；当前反代支持 PNG/JPEG/WebP，单张解码后最多 10 MiB。
- 图片尺寸、比例、张数由模型能力限制。反代 JSON 请求体上限 60 MiB，sub2api 或前置代理可以配置更小的限制。
- 视频、音频必须提供可直接下载的公开 HTTP(S) URL，不能提供本地文件路径、`blob:`、局域网地址或需登录的页面链接。
- 当前 sub2api 会下载并核验参考视频：单个最多 100 MiB，检测时长需大于 0 且不超过 120 秒；这不是模型保证接受 120 秒参考素材，模型仍可进一步限制。
- 当前核验传输不自动跟随视频链接重定向。尽量提供直接返回视频内容的最终地址。
- 提示词可使用「图片1」「视频1」「音频1」引用对应编号。
- Flash 当前不接收音频参考；其他模型也不能直接照搬 4.0 的素材上限。请求遇到能力限制时调整素材或模型，不要静默删除素材继续提交。

## 6. 状态、查询权限与结果

| `data.task_status` | 处理方式 |
| --- | --- |
| `submitted` | 已接收，继续查询 |
| `processing` | 生成中，继续查询 |
| `succeed` | 成功，读取 `task_result.videos` |
| `failed` | 失败，查看 `task_status_msg`，停止轮询 |
| `submission_unknown` | 提交结果未知，停止自动重提，联系管理员核对原任务 |

查询必须使用创建任务时的 **同一 API Key**，保留原分组绑定。当前任务归属校验包含用户、API Key、分组及上游账号；同一用户换另一把 Key，也可能查不到原任务。

普通兼容接口通过 `videos[].url` 返回结果。网页视频台使用的 `/api/v1/video-studio/tasks/.../content` 属于另一套登录态接口，不应拼进这套外部 API 流程。

## 7. 计费与通道选择

- 最终费用按 sub2api 的模型价格、分辨率、模式、分组倍率及实际记账规则计算；网页工作台显示的是预估值。
- 普通视频使用输出秒数计算视频费用。带参考视频时，当前计费秒数为：

```text
输出视频秒数 + ceil(所有参考视频实际时长之和)
```

例如输出 5 秒，两个参考视频分别为 2.2 秒和 3.1 秒，则计费时长是 `5 + ceil(5.3) = 11` 秒。不能只按输出 5 秒估算。

- 费用在接受生成任务后记录；当前不是等视频成功后才记账。后续失败是否退款，以实际账单和管理员处理为准，不能自行假设会自动退费。
- 查询状态本身不创建新视频，当前不会新增 Kling 生成用量；查询仍受 Key 状态、权限和额度校验影响。
- `channel: auto` 由后面的反代执行每日积分及网页/CLI 切换策略，调用方无需指定账号。
- `browser` 固定网页通道，`paid` 固定官方 CLI 通道；`paid` 是通道名，不表示账户上存在独立于网页总积分的第二份余额。
- sub2api 向下游结算的费用与 Kling 账号池里的积分是两层账目，不能直接用账号积分差推算下游价格。

## 8. 提交超时、重试和幂等边界

为每个新任务保存一个 `Idempotency-Key`，并将业务编号、请求正文、API Key 标识和任务回执关联保存。不同任务使用不同编号；相同编号不要搭配不同正文。

当前外部 `/kling/v1` 将这个编号按 API Key 和被选中的上游账号做隔离后，再传给反代。**这不是整个网关链路严格“只生成一次”的保证**：重试时重新选到其他上游账号，编号的上游作用域可能变化；不能据此自动反复 POST。

| 场景 | 建议处理 |
| --- | --- |
| 已取得任务 ID，查询暂时超时/5xx | 保存 ID，稍后继续 GET 查询，不要重新生成 |
| 提交超时、断线或 5xx，未取得任务 ID | 标记为提交待核对，先检查管理台与反代日志；不要立即换编号重提 |
| 明确的 400 参数错误、401 鉴权错误等 | 修正错误；按新业务提交保存新的请求记录 |
| 429 | 尊重限流提示；GET 可退避重试，POST 先判断是否已接单 |

外部 `/kling/v1` 当前没有网页工作台那套 `/submissions/{key}` 回执恢复入口，也不会把调用方的 `Prefer: respond-async` 请求头转发给反代。不要直接套用反代 8020 端口文档里的快速回执和恢复流程。

创建请求建议留足等待时间。任务生成可以持续数分钟，轮询用独立的 30–45 分钟业务等待上限；达到等待上限不代表上游失败，只需保留 ID 后续继续查。

## 9. Python 轮询示例（只查已有任务）

先使用第 2 节创建任务并保存 ID。下面脚本只发送 GET，不会再次创建视频；需要继续等待时重新运行即可。

保存为 `poll_kling.py`：

```python
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

base = os.environ["SUB2API_URL"].rstrip("/")
api_key = os.environ["SUB2API_API_KEY"]
kind = os.environ.get("KLING_TASK_KIND", "text2video")
if kind not in {"text2video", "image2video"}:
    raise SystemExit("KLING_TASK_KIND 只能是 text2video 或 image2video")
if len(sys.argv) != 2:
    raise SystemExit("用法：python3 poll_kling.py TASK_ID")
task_id = sys.argv[1]
url = f"{base}/kling/v1/videos/{kind}/{quote(task_id, safe='')}"
deadline = time.monotonic() + 45 * 60

while time.monotonic() < deadline:
    request = Request(url, headers={"Authorization": f"Bearer {api_key}"})
    try:
        with urlopen(request, timeout=60) as response:
            body = json.load(response)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        if error.code == 429 or 500 <= error.code < 600:
            print(f"查询暂不可用 HTTP {error.code}，保留原任务继续等待", flush=True)
            time.sleep(10)
            continue
        raise SystemExit(f"查询失败 HTTP {error.code}: {detail}")
    except (URLError, TimeoutError):
        print("查询网络超时，保留原任务继续等待", flush=True)
        time.sleep(10)
        continue

    if body.get("code") != 0:
        raise SystemExit(f"接口错误：{json.dumps(body, ensure_ascii=False)}")
    data = body.get("data") or {}
    status = data.get("task_status")
    print(f"{task_id}: {status}", flush=True)
    if status == "succeed":
        videos = (data.get("task_result") or {}).get("videos") or []
        if not videos or any(not item.get("url") for item in videos):
            raise SystemExit("任务显示成功但结果地址缺失，请保留任务编号核查")
        with open("task-result.json", "w", encoding="utf-8") as output:
            json.dump(body, output, ensure_ascii=False, indent=2)
        for index, video in enumerate(videos, 1):
            print(f"视频 {index}: {video['url']}")
        break
    if status in {"failed", "submission_unknown"}:
        raise SystemExit(data.get("task_status_msg") or status)
    if status not in {"submitted", "processing"}:
        raise SystemExit(f"未知任务状态 {status!r}，请保留任务编号核查")
    time.sleep(5)
else:
    raise SystemExit("等待超过 45 分钟；任务未被取消，请保留任务编号稍后继续查询")
```

运行：

```bash
# 文生视频
python3 poll_kling.py "$TASK_ID"

# 图生视频 / 全能参考
KLING_TASK_KIND=image2video python3 poll_kling.py '替换成图生视频的task_id'
```

## 10. 常见错误

| 现象 | 优先检查 |
| --- | --- |
| 401 / `Invalid API key` | 是否使用 sub2api 用户 API Key，是否过期/禁用；不要传上游 JWT 或 Access/Secret 拼接串 |
| 403 / 权限错误 | Key 所属分组、用户权限和生图/视频权限开关 |
| 404 / 模型不可用 | 路径是否带 `/kling/v1`；分组白名单是否放行模型 |
| 404 / `Video request not found` | 是否使用创建任务的同一 API Key、分组和正确查询接口 |
| 400 / `Unsupported field` | 是否误用了 `model`、`image_url`、`seconds`、`model_mode` 等其他协议字段 |
| 400 / 素材能力错误 | 槽位名称、张数、时长、音频互斥及模型能力是否匹配 |
| 400 / `invalid_reference_video` | 视频地址能否直接下载、是否重定向、大小和媒体元数据是否有效 |
| 402 / 余额或额度不足 | sub2api 用户余额、Key 配额、订阅或上游账号积分 |
| 429 | 并发、速率限制或当前账号容量 |
| 502 / 上游错误 | 查看 `error.message`，结合 sub2api 运维日志与 Kling 反代任务历史排查 |
| 一直 `processing` | 保留任务 ID，查看原任务状态；不要重复 POST 生成 |
| 图生人物或首帧不符合预期 | 需要固定首帧时使用 `image`；全能参考只提供人物/场景参考，不保证逐像素一致 |

成功响应通常是 Kling 的 `code/message/data` 格式，网关错误通常是 `{"error":{"type":"...","message":"..."}}`；客户端应同时检查 HTTP 状态和 JSON 正文。

## 11. 外部接口与网页视频台的区别

| 项目 | 本文外部接口 | 网页视频台内部接口 |
| --- | --- | --- |
| 路径 | `/kling/v1/...` | `/api/v1/video-studio/...` |
| 鉴权 | sub2api 用户 API Key | 网站登录 JWT |
| 模型字段 | `model_name` | `model`，网页会进一步映射 |
| 分组 | API Key 绑定的 Kling 分组 | 网页按 `X-Video-Studio-Group` 选择可用视频分组 |
| 返回编号 | 传统格式 `data.task_id` | 标准化的 `id`，部分带 `klingi2v:` / `kling4:` 前缀 |
| 提交恢复 | 参见第 8 节，不能假设有网页恢复能力 | 网页有独立持久化回执及原任务恢复机制 |

第三方系统对接使用本文的外部接口。不要从网页开发者工具复制登录态接口后，只把登录 JWT 换成用户 API Key。

## 12. 当前部署的功能边界

- 不提供 OpenAI Chat Completions 风格的视频生成功能。
- 传统接口使用一个创建请求对应一条视频任务；需要多条结果时由业务端创建独立任务并分别保存回执，不使用网页内部的 `quantity` 字段。
- 当前反代不支持 `callback_url` 和 `external_task_id`；使用任务编号轮询。
- 图片文件不使用 `multipart/form-data` 直接上传到这些视频端点；用公开图片 URL 或图片 Base64。
- 视频参考会影响计费时长，模型支持的素材组合还受上游实时能力限制。
- 4.0 专用入口和普通 `/videos/...` 接口不能混用查询解析；全能参考采用本文第 5 节的扩展格式。

本文根据当前代码核对编写；5 个生成请求示例均通过反代参数映射器的离线校验，JSON、Shell 和 Python 示例已做语法检查。没有为编写文档提交真实视频生成任务。
