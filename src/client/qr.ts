import * as QRCode from "qrcode";

export async function renderPairingQr(data: string): Promise<string> {
  const svg = await QRCode.toString(data, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: {
      dark: "#07100d",
      light: "#ffffff",
    },
  });

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
