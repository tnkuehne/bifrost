import { Resvg } from "@resvg/resvg-js";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin } from "vite";

const backgroundColor = "#f5faf7";
const manifestPath = "/assets/manifest.webmanifest";
const sourcePath = fileURLToPath(new URL("../src/client/assets/webcam.svg", import.meta.url));

const appleTouchIcon = { path: "/assets/apple-touch-icon.png", size: 180 } as const;
const manifestIcons = [
  { path: "/assets/icon-192.png", size: 192, purpose: "any" },
  { path: "/assets/icon-512.png", size: 512, purpose: "any" },
  { path: "/assets/icon-maskable-512.png", size: 512, purpose: "maskable", paddingRatio: 0.1 },
] as const;
const icons = [appleTouchIcon, ...manifestIcons] as const;

function renderIcon(icon: (typeof icons)[number]) {
  const svg = readFileSync(sourcePath, "utf8");
  const padding = Math.round(icon.size * ("paddingRatio" in icon ? icon.paddingRatio : 0));
  const imageSize = icon.size - padding * 2;
  const imageHref = Buffer.from(svg).toString("base64");
  const wrappedSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${icon.size}" height="${icon.size}" viewBox="0 0 ${icon.size} ${icon.size}">
      <rect width="${icon.size}" height="${icon.size}" fill="${backgroundColor}" />
      <image href="data:image/svg+xml;base64,${imageHref}" x="${padding}" y="${padding}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid meet" />
    </svg>
  `;

  return new Resvg(wrappedSvg).render().asPng();
}

function manifest() {
  return JSON.stringify(
    {
      name: "Bifrost",
      short_name: "Bifrost",
      scope: "/",
      display: "standalone",
      background_color: backgroundColor,
      theme_color: backgroundColor,
      icons: manifestIcons.map((icon) => ({
        src: icon.path,
        sizes: `${icon.size}x${icon.size}`,
        type: "image/png",
        purpose: icon.purpose,
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
        href: appleTouchIcon.path,
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

export function appIconsPlugin(): Plugin {
  return {
    name: "app-icons",
    buildStart() {
      this.addWatchFile(sourcePath);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?", 1)[0];

        if (path === manifestPath) {
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/manifest+json");
          response.setHeader("Cache-Control", "no-cache");
          response.end(manifest());
          return;
        }

        const icon = icons.find((candidate) => candidate.path === path);

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
