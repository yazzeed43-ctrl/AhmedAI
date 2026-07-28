const Module = require("module");
const path = require("path");

process.env.NEXT_PUBLIC_SUPABASE_URL ??=
  "https://placeholder.supabase.co";

process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "placeholder";

const compiledRoot = path.resolve(
  __dirname,
  "..",
  "..",
  ".test-dist-social-reliability",
);

const originalResolveFilename =
  Module._resolveFilename;

Module._resolveFilename = function (
  request,
  parent,
  isMain,
  options,
) {
  if (
    typeof request === "string" &&
    request.startsWith("@/")
  ) {
    const mappedRequest = path.join(
      compiledRoot,
      request.slice(2),
    );

    return originalResolveFilename.call(
      this,
      mappedRequest,
      parent,
      isMain,
      options,
    );
  }

  return originalResolveFilename.call(
    this,
    request,
    parent,
    isMain,
    options,
  );
};