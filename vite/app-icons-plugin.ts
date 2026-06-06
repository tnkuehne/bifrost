import { Resvg } from "@resvg/resvg-js";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin } from "vite";

type IconPurpose = "any" | "maskable";

type PngIcon = {
  path: `/${string}`;
  size: number;
  purpose?: IconPurpose;
  paddingRatio?: number;
};

type AppIconsPluginOptions = {
  backgroundColor: string;
  display?: "fullscreen" | "standalone" | "minimal-ui" | "browser";
  icons?: PngIcon[];
  name: string;
  shortName?: string;
  source: URL;
  startUrl?: string;
  themeColor?: string;
};

const defaultIcons: PngIcon[] = [
  { path: "/apple-touch-icon.png", size: 180 },
  { path: "/icon-192.png", size: 192, purpose: "any" },
  { path: "/icon-512.png", size: 512, purpose: "any" },
  { path: "/icon-maskable-512.png", size: 512, purpose: "maskable", paddingRatio: 0.1 },
];

const manifestPath = "/manifest.webmanifest";

export function appIconsPlugin(options: AppIconsPluginOptions): Plugin {
  const sourcePath = fileURLToPath(options.source);
  const icons = options.icons ?? defaultIcons;

  function renderIcon(icon: PngIcon) {
    const svg = readFileSync(sourcePath, "utf8");
    const padding = Math.round(icon.size * (icon.paddingRatio ?? 0));
    const imageSize = icon.size - padding * 2;
    const imageHref = Buffer.from(svg).toString("base64");
    const wrappedSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${icon.size}" height="${icon.size}" viewBox="0 0 ${icon.size} ${icon.size}">
        <rect width="${icon.size}" height="${icon.size}" fill="${options.backgroundColor}" />
        <image href="data:image/svg+xml;base64,${imageHref}" x="${padding}" y="${padding}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid meet" />
      </svg>
    `;

    return new Resvg(wrappedSvg).render().asPng();
  }

  function manifest() {
    return JSON.stringify(
      {
        name: options.name,
        short_name: options.shortName ?? options.name,
        start_url: options.startUrl ?? "/",
        display: options.display ?? "standalone",
        background_color: options.backgroundColor,
        theme_color: options.themeColor ?? options.backgroundColor,
        icons: icons
          .filter((icon) => icon.path !== "/apple-touch-icon.png")
          .map((icon) => ({
            src: icon.path,
            sizes: `${icon.size}x${icon.size}`,
            type: "image/png",
            ...(icon.purpose ? { purpose: icon.purpose } : {}),
          })),
      },
      null,
      2,
    );
  }

  function htmlTags(html: string): HtmlTagDescriptor[] {
    const tags: HtmlTagDescriptor[] = [];

    if (!html.includes('rel="apple-touch-icon"')) {
      tags.push({
        tag: "link",
        attrs: {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/apple-touch-icon.png",
        },
        injectTo: "head",
      });
    }

    if (!html.includes('rel="manifest"')) {
      tags.push({
        tag: "link",
        attrs: {
          rel: "manifest",
          href: manifestPath,
        },
        injectTo: "head",
      });
    }

    return tags;
  }

  return {
    name: "app-icons",
    buildStart() {
      this.addWatchFile(sourcePath);
    },
    configureServer(server) {
      const iconRoutes = new Map<string, PngIcon>(icons.map((icon) => [icon.path, icon]));

      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?", 1)[0];

        if (path === manifestPath) {
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/manifest+json");
          response.setHeader("Cache-Control", "no-cache");
          response.end(manifest());
          return;
        }

        const icon = path ? iconRoutes.get(path) : undefined;

        if (!icon) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", "image/png");
        response.setHeader("Cache-Control", "no-cache");
        response.end(renderIcon(icon));
      });
    },
    generateBundle() {
      for (const icon of icons) {
        this.emitFile({
          type: "asset",
          fileName: icon.path.slice(1),
          source: renderIcon(icon),
        });
      }

      this.emitFile({
        type: "asset",
        fileName: manifestPath.slice(1),
        source: manifest(),
      });
    },
    transformIndexHtml: {
      order: "post",
      handler: htmlTags,
    },
  };
}
