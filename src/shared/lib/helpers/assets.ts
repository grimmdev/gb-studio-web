import Path from "path";

export type Asset = {
  filename: string;
  plugin?: string;
  _v?: number;
};

export type AssetType =
  | "avatars"
  | "backgrounds"
  | "emotes"
  | "tilesets"
  | "fonts"
  | "music"
  | "sounds"
  | "sprites"
  | "ui";

export const assetPath = (assetType: AssetType, asset: Asset) => {
  return (
    asset.plugin
      ? Path.join("plugins", asset.plugin, assetType, asset.filename)
      : Path.join("assets", assetType, asset.filename)
  ).replace(/\\/g, "/");
};

export const assetFilename = (
  projectRoot: string,
  assetType: AssetType,
  asset: Asset,
) => {
  return Path.join(projectRoot, assetPath(assetType, asset));
};

export const isWeb =
  typeof window !== "undefined" &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((window as any).API?.env === "web" ||
    (Boolean(window.location?.protocol?.startsWith("http")) &&
      !navigator?.userAgent?.includes("Electron")));

export const assetURL = (assetType: AssetType, asset: Asset) => {
  const base = isWeb ? "/api/assets/project" : "gbs://project";
  return `${base}/${assetPath(assetType, asset)}?_v=${asset._v}`;
};

export const assetURLStyleProp = (assetType: AssetType, asset: Asset) => {
  return `url("${assetURL(assetType, asset)}")`;
};

export const assetNameFromFilename = (filename: string) => {
  return filename.replace(/\.[^.]*$/, "");
};
