---
"xenon-cms": minor
---

Add presigned direct-to-S3/R2 uploads with `HEAD` + Range-`GET` security and dimension verification (#13):

- Extend `StorageAdapter` with optional `createPresignedUpload`, `head`, and `readRange` methods, implemented in `S3StorageAdapter` using `aws4fetch` SigV4 query signing (binding `content-type` and `content-length`).
- Add `presignUpload`, `completeUpload`, and `supportsPresignedUploads` to the Local API (`xenon-cms/server`) plus `POST /{api}/{collection}/_presign` and `POST /{api}/{collection}/_complete` in `xenon-cms/http`.
- Preserve Critical #2 upload security on `_complete`: verifies an HMAC-signed upload token, key prefix, replay guard, `HEAD` (`Content-Length <= maxFileSize` and non-active `Content-Type`), and a bounded `<= 64 KB` Range `GET` to sniff magic bytes, block active markup, and extract `image-size` dimensions before saving (immediately deleting rejected objects).
- Automatically switch admin UI uploads (`useServices().upload`) to the 3-step direct-to-storage flow when the configured storage adapter supports presigned uploads, keeping multipart uploads for local storage.
