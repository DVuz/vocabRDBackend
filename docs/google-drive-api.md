# Google Drive API

Tài liệu này mô tả các API backend dùng để đọc folder bài học từ Google Drive.

## Thông tin chung

Base URL:

```text
http://localhost:3000/api
```

Tất cả API đều yêu cầu access token JWT:

```http
Authorization: Bearer ACCESS_TOKEN
```

Swagger:

```text
http://localhost:3000/docs
```

Các response JSON thông thường được bọc bởi interceptor:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {}
}
```

Các API `stream` và `download` trả về dữ liệu file nhị phân thay vì JSON.

## Cấu trúc Google Drive mẫu

```text
EnglishPublish/
└── Speaking/
    ├── audio/
    │   ├── city.wav
    │   ├── house_or_apartment.wav
    │   └── where_you_live.wav
    ├── house_or_apartment.md
    └── where_you_live.md
```

File Markdown có thể tham chiếu audio bằng cú pháp Obsidian:

```markdown
![[house_or_apartment.wav]]
```

hoặc Markdown link:

```markdown
[Nghe audio](audio/house_or_apartment.wav)
```

Backend tìm file audio trong folder `audio` hoặc `Audio` cùng cấp với file
Markdown.

## 1. Lấy cây folder và file

```http
GET /api/google-drive/tree
```

Lấy toàn bộ folder và file đệ quy từ folder được cấu hình bởi
`GOOGLE_DRIVE_FOLDER_ID`.

Có thể bắt đầu từ một folder khác:

```http
GET /api/google-drive/tree?folderId=FOLDER_ID
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {
    "id": "root-folder-id",
    "name": "EnglishPublish",
    "type": "folder",
    "mimeType": "application/vnd.google-apps.folder",
    "children": [
      {
        "id": "speaking-folder-id",
        "name": "Speaking",
        "type": "folder",
        "mimeType": "application/vnd.google-apps.folder",
        "children": [
          {
            "id": "lesson-file-id",
            "name": "house_or_apartment.md",
            "type": "file",
            "mimeType": "text/markdown",
            "size": "2048",
            "modifiedTime": "2026-10-06T08:56:30.901Z"
          },
          {
            "id": "audio-folder-id",
            "name": "audio",
            "type": "folder",
            "children": [
              {
                "id": "audio-file-id",
                "name": "house_or_apartment.wav",
                "type": "file",
                "mimeType": "audio/wav",
                "size": "123456",
                "modifiedTime": "2026-10-06T08:50:00.000Z"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Các trường:

- `id`: Google Drive file ID hoặc folder ID.
- `name`: tên file/folder.
- `type`: `folder` hoặc `file`.
- `mimeType`: loại dữ liệu.
- `size`: kích thước file, có thể không có với folder.
- `modifiedTime`: thời điểm cập nhật cuối.
- `children`: danh sách con, chỉ có với folder.

API này phù hợp để xây sidebar, file explorer và dashboard.

## 2. Lấy file/folder trực tiếp trong folder gốc

```http
GET /api/google-drive/files
```

Chỉ lấy các item trực tiếp bên trong `GOOGLE_DRIVE_FOLDER_ID`, không quét
folder con.

### Query parameters

```text
search   Tùy chọn. Tìm theo tên item.
folderId Tùy chọn. Folder bắt đầu truy vấn, mặc định là folder gốc.
```

Ví dụ:

```http
GET /api/google-drive/files?search=speaking
GET /api/google-drive/files?folderId=speaking-folder-id
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": [
    {
      "id": "speaking-folder-id",
      "name": "Speaking",
      "type": "folder",
      "mimeType": "application/vnd.google-apps.folder"
    }
  ]
}
```

API này chỉ trả metadata, không trả nội dung Markdown hoặc audio.

## 3. Lấy item trực tiếp trong một folder

```http
GET /api/google-drive/folders/:folderId/files
```

Ví dụ:

```http
GET /api/google-drive/folders/speaking-folder-id/files
GET /api/google-drive/folders/speaking-folder-id/files?search=house
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": [
    {
      "id": "lesson-file-id",
      "name": "house_or_apartment.md",
      "type": "file",
      "mimeType": "text/markdown",
      "size": "2048",
      "modifiedTime": "2026-10-06T08:56:30.901Z"
    },
    {
      "id": "audio-folder-id",
      "name": "audio",
      "type": "folder",
      "mimeType": "application/vnd.google-apps.folder"
    }
  ]
}
```

API này phù hợp khi frontend mở một folder và chỉ muốn tải nội dung cấp hiện
tại.

## 4. Tìm file theo tên trong toàn bộ cây

```http
GET /api/google-drive/search?q=house
```

Có thể giới hạn phạm vi:

```http
GET /api/google-drive/search?q=house&folderId=speaking-folder-id
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": [
    {
      "id": "lesson-file-id",
      "name": "house_or_apartment.md",
      "type": "file",
      "mimeType": "text/markdown",
      "path": [
        "Speaking",
        "house_or_apartment.md"
      ]
    },
    {
      "id": "audio-file-id",
      "name": "house_or_apartment.wav",
      "type": "file",
      "mimeType": "audio/wav",
      "path": [
        "Speaking",
        "audio",
        "house_or_apartment.wav"
      ]
    }
  ]
}
```

`q` là bắt buộc. API tìm theo tên file, không tìm theo nội dung bên trong
Markdown.

## 5. Lấy metadata của một file

```http
GET /api/google-drive/files/:fileId
```

Ví dụ:

```http
GET /api/google-drive/files/lesson-file-id
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {
    "id": "lesson-file-id",
    "name": "house_or_apartment.md",
    "mimeType": "text/markdown",
    "size": "2048",
    "modifiedTime": "2026-10-06T08:56:30.901Z",
    "webViewLink": "https://drive.google.com/..."
  }
}
```

API này không trả nội dung file. `webViewLink` dùng để mở file trên Google
Drive và vẫn phụ thuộc quyền truy cập của người dùng.

## 6. Đọc nội dung Markdown/text

```http
GET /api/google-drive/files/:fileId/content
```

Ví dụ:

```http
GET /api/google-drive/files/lesson-file-id/content
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {
    "id": "lesson-file-id",
    "name": "house_or_apartment.md",
    "mimeType": "text/markdown",
    "modifiedTime": "2026-10-06T08:56:30.901Z",
    "content": "![[house_or_apartment.wav]]\n\n### 1. What kind of housing do you live in?\n...",
    "audioFiles": [
      {
        "id": "audio-file-id",
        "name": "house_or_apartment.wav",
        "type": "file",
        "mimeType": "audio/wav",
        "size": "123456",
        "modifiedTime": "2026-10-06T08:50:00.000Z",
        "streamUrl": "/api/google-drive/files/audio-file-id/stream"
      }
    ]
  }
}
```

`content` là nguyên văn nội dung Markdown. `audioFiles` là các audio mà
backend tìm thấy từ link trong Markdown. Nếu không tìm thấy audio, mảng này
sẽ là `[]`.

## 7. Lấy dữ liệu bài học hoàn chỉnh

```http
GET /api/google-drive/files/:fileId/lesson
```

API này nên được frontend dùng khi người dùng mở một bài học Markdown.

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {
    "id": "lesson-file-id",
    "title": "house_or_apartment",
    "mimeType": "text/markdown",
    "markdown": "![[house_or_apartment.wav]]\n\n### 1. What kind of housing do you live in?\n...",
    "audios": [
      {
        "id": "audio-file-id",
        "name": "house_or_apartment.wav",
        "mimeType": "audio/wav",
        "streamUrl": "/api/google-drive/files/audio-file-id/stream"
      }
    ]
  }
}
```

Frontend dùng:

- `title`: tiêu đề bài học.
- `markdown`: render bằng `react-markdown`.
- `audios`: tạo audio player.

## 8. Stream audio hoặc media

```http
GET /api/google-drive/files/:fileId/stream
```

Ví dụ:

```http
GET /api/google-drive/files/audio-file-id/stream
```

API trả binary stream, không trả JSON. `Content-Type` được lấy theo loại file,
ví dụ `audio/wav` hoặc `audio/mpeg`.

Frontend:

```tsx
<audio
  controls
  src={`${API_URL}/api/google-drive/files/${audio.id}/stream`}
/>
```

Endpoint vẫn yêu cầu JWT. Nếu dùng `audio src` trực tiếp, frontend cần dùng
cookie authentication hoặc cơ chế URL có quyền tạm thời; thẻ `<audio>` không
tự thêm header `Authorization`.

## 9. Download file

```http
GET /api/google-drive/files/:fileId/download
```

API trả binary file với header:

```http
Content-Disposition: attachment
```

Dùng cho nút tải Markdown hoặc audio. Nếu endpoint yêu cầu Bearer token, nên
dùng `fetch` có header Authorization rồi tạo Blob URL để tải.

## Cache Redis

Nếu có `REDIS_URL`, các dữ liệu sau được cache trong 5 phút:

- Cây folder.
- Danh sách item trong folder.
- Metadata file.
- Nội dung Markdown và dữ liệu lesson.

```env
REDIS_URL=redis://default:PASSWORD@HOST:PORT
```

Cây folder gốc được cron tải lại từ Google Drive sau mỗi 5 phút. Audio không
lưu trong Redis mà được stream trực tiếp từ Google Drive.

## Luồng frontend đề xuất

1. Gọi `GET /api/google-drive/tree` để hiển thị cây folder.
2. Lọc các file có `mimeType: text/markdown` để hiển thị danh sách bài.
3. Khi chọn bài, gọi `GET /api/google-drive/files/:fileId/lesson`.
4. Render trường `markdown`.
5. Dùng `audios[].streamUrl` để hiển thị `<audio controls>`.
6. Dùng API `search` cho ô tìm kiếm theo tên file.
