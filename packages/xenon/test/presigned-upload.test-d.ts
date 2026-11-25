import type {
  PresignedUploadInput,
  PresignedUploadResult,
  StorageAdapter,
  StoredFileHead,
} from "../src/index";
import { defineCollection, defineConfig, text } from "../src/index";
import { createXenon } from "../src/server/index";
import { S3StorageAdapter } from "../src/storage/s3";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false
    : false;
type Expect<T extends true> = T;

const media = defineCollection({
  slug: "media",
  upload: { mimeTypes: ["image/*"], maxFileSize: 5_000_000 },
  fields: { alt: text({ required: true }) },
});
const config = defineConfig({ collections: [media] });
const xenon = createXenon(config);

// StorageAdapter optional presigned methods are additive and implemented by S3StorageAdapter.
const s3 = new S3StorageAdapter({
  bucket: "b",
  endpoint: "https://r2.example",
  accessKeyId: "k",
  secretAccessKey: "s",
  publicUrl: "https://cdn.example",
});
const adapter: StorageAdapter = s3;
type _PresignReturn = Expect<Equal<ReturnType<S3StorageAdapter["createPresignedUpload"]>, Promise<PresignedUploadResult>>>;
type _HeadReturn = Expect<Equal<ReturnType<S3StorageAdapter["head"]>, Promise<StoredFileHead | null>>>;
type _RangeReturn = Expect<Equal<ReturnType<S3StorageAdapter["readRange"]>, Promise<Uint8Array | null>>>;
const _input: PresignedUploadInput = { key: "media/a.png", contentType: "image/png", size: 10, expiresIn: 60 };
void adapter;
void _input;

// Local API presignUpload / completeUpload preserve collection slug & document return types.
type _SupportsFlag = Expect<Equal<typeof xenon.supportsPresignedUploads, boolean>>;

async function checkLocalApi() {
  const presigned = await xenon.presignUpload({
    collection: "media",
    filename: "hero.png",
    mimeType: "image/png",
    size: 1024,
  });
  const _token: string = presigned.token;
  const _method: "PUT" | "POST" = presigned.upload.method;
  void _token;
  void _method;

  const doc = await xenon.completeUpload({
    collection: "media",
    token: presigned.token,
    data: { alt: "Hero" },
  });
  type _DocAlt = Expect<Equal<typeof doc.alt, string>>;
  type _DocWidth = Expect<Equal<typeof doc.width, number | null | undefined>>;
  type _DocUrl = Expect<Equal<typeof doc.url, string>>;

  // @ts-expect-error Unknown collection slug is rejected.
  await xenon.presignUpload({ collection: "unknown", filename: "a.png", mimeType: "image/png", size: 10 });
  // @ts-expect-error System-managed upload metadata cannot be passed in completeUpload data.
  await xenon.completeUpload({ collection: "media", token: presigned.token, data: { alt: "x", filename: "forged.png" } });
}
void checkLocalApi;
