import type { ExportedLabelTemplate, IdentifiedRoll, LabelProps, LabelShape } from "$/types";
import type { PrintDirection, RfidInfo } from "@mmote/niimbluelib";

const RFID_CACHE_KEY = "niimblue_rfid_roll_cache";
const API_URL = "https://print.niimbot.com/api/template/getCloudTemplateByOneCode";

export const PAPER_TYPE_NAMES: Record<number, string> = {
  1: "Gap label",
  2: "Continuous label",
  3: "Black mark label",
  4: "Transparent label",
  5: "Front label",
};

interface CachedRoll {
  barcode: string;
  name: string;
  width: number;
  height: number;
  paperType: number;
  paperTypeName?: string;
  previewImage?: string;
  isCable?: boolean;
  cableLength?: number;
  cableDirection?: number;
}

const getCache = (): Record<string, CachedRoll> => {
  try {
    const raw = localStorage.getItem(RFID_CACHE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Failed to read RFID cache", e);
  }
  return {};
};

const saveCache = (barcode: string, data: CachedRoll) => {
  try {
    const cache = getCache();
    cache[barcode] = data;
    localStorage.setItem(RFID_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error("Failed to save RFID cache", e);
  }
};

export class RfidIdentifier {
  public static async identify(barcode: string, rfidInfo?: RfidInfo): Promise<IdentifiedRoll | undefined> {
    if (!barcode || barcode.trim() === "") {
      return undefined;
    }

    const cleanBarcode = barcode.trim();
    const cache = getCache();
    let rollData = cache[cleanBarcode];

    if (!rollData) {
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "niimbot-user-agent": "AppVersionName/999.0.0",
          },
          body: JSON.stringify({ oneCode: cleanBarcode }),
        });

        if (!res.ok) {
          console.warn(`Niimbot API returned status ${res.status}`);
          return undefined;
        }

        const json = await res.json();
        if (json.code === 1 && json.data) {
          const d = json.data;
          let rollName = d.name ?? "";
          if (Array.isArray(d.names)) {
            const enName = d.names.find((n: any) => n.languageCode === "en" && n.name?.trim());
            if (enName) {
              rollName = enName.name;
            }
          }

          rollData = {
            barcode: cleanBarcode,
            name: rollName,
            width: Number(d.width) || 0,
            height: Number(d.height) || 0,
            paperType: Number(d.paperType) || 1,
            paperTypeName: PAPER_TYPE_NAMES[Number(d.paperType)] || `Type ${d.paperType}`,
            previewImage: d.previewImage || d.backgroundImage,
            isCable: Boolean(d.isCable),
            cableLength: Number(d.cableLength) || 0,
            cableDirection: Number(d.cableDirection) || 0,
          };

          saveCache(cleanBarcode, rollData);
        }
      } catch (err) {
        console.error("Failed to query Niimbot cloud API for roll info:", err);
      }
    }

    if (!rollData) {
      return undefined;
    }

    const remainingPaper =
      rfidInfo?.allPaper !== undefined && rfidInfo?.usedPaper !== undefined && rfidInfo.allPaper > 0
        ? Math.max(0, rfidInfo.allPaper - rfidInfo.usedPaper)
        : undefined;

    return {
      ...rollData,
      allPaper: rfidInfo?.allPaper,
      usedPaper: rfidInfo?.usedPaper,
      remainingPaper,
    };
  }

  /**
   * Computes canvas LabelProps dimensions based on printer orientation.
   * D110/D11 uses "left" print direction (height is along printhead 12/15mm, width is feed 30/40mm).
   * B1/B21 uses "top" print direction (width is along printhead 50mm, height is feed 30mm).
   * For cable labels, sets vertical fold split and mirrored flip so both sides match.
   */
  public static calculateLabelProps(
    roll: IdentifiedRoll,
    printDirection: PrintDirection,
    dpmm: number = 8
  ): Partial<LabelProps> {
    const dim1 = roll.width;
    const dim2 = roll.height;

    const tapeWidth = Math.min(dim1, dim2);
    let feedLength = Math.max(dim1, dim2);

    if (roll.isCable && roll.cableLength) {
      feedLength += roll.cableLength;
    }

    let canvasWidthMm = feedLength;
    let canvasHeightMm = tapeWidth;

    if (printDirection === "top") {
      canvasWidthMm = tapeWidth;
      canvasHeightMm = feedLength;
    } else {
      canvasWidthMm = feedLength;
      canvasHeightMm = tapeWidth;
    }

    let widthPx = Math.floor(canvasWidthMm * dpmm);
    let heightPx = Math.floor(canvasHeightMm * dpmm);

    // Alignment must be multiple of 8
    if (printDirection === "left") {
      heightPx -= heightPx % 8;
    } else {
      widthPx -= widthPx % 8;
    }

    const shape: LabelShape = dim1 === dim2 ? "circle" : "rect";

    let split: "none" | "vertical" | "horizontal" = "none";
    let splitParts = 2;
    let mirror: "none" | "flip" | "copy" = "none";
    let tailLength = 0;
    let tailPos: "right" | "bottom" | "left" | "top" = "right";

    if (roll.isCable) {
      split = "vertical";
      splitParts = 2;
      mirror = "flip"; // Symmetrical fold-over mirroring!
      if (roll.cableLength) {
        tailLength = Math.floor(roll.cableLength * dpmm);
        tailPos = roll.cableDirection === 1 ? "right" : "left";
      }
    }

    return {
      printDirection,
      size: {
        width: widthPx,
        height: heightPx,
      },
      shape,
      split,
      splitParts,
      mirror,
      tailLength,
      tailPos,
    };
  }

  public static createDefaultTemplateForRoll(
    roll: IdentifiedRoll,
    printDirection: PrintDirection,
    dpmm: number = 8
  ): ExportedLabelTemplate {
    const labelProps = this.calculateLabelProps(roll, printDirection, dpmm) as LabelProps;

    const width = labelProps.size.width;
    const height = labelProps.size.height;
    const tailLength = labelProps.tailLength ?? 0;

    let targetX = width / 2;
    let targetY = height / 2;
    let textWidth = Math.min(200, width * 0.8);

    if (labelProps.split === "vertical") {
      const flagWidth = width - tailLength;
      const sideAWidth = flagWidth / 2;
      const startX = labelProps.tailPos === "left" ? tailLength : 0;
      targetX = startX + sideAWidth / 2;
      targetY = height / 2;
      textWidth = Math.min(160, sideAWidth * 0.85);
    }

    const defaultObject = {
      type: "Textbox",
      version: "6.5.4",
      originX: "center",
      originY: "center",
      left: Math.round(targetX),
      top: Math.round(targetY),
      width: Math.round(textWidth),
      height: 28,
      fill: "black",
      stroke: null,
      strokeWidth: 1,
      strokeDashArray: null,
      strokeLineCap: "butt",
      strokeDashOffset: 0,
      strokeLineJoin: "miter",
      strokeUniform: false,
      strokeMiterLimit: 4,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      shadow: null,
      visible: true,
      backgroundColor: "",
      fillRule: "nonzero",
      paintFirst: "fill",
      globalCompositeOperation: "source-over",
      skewX: 0,
      skewY: 0,
      fontFamily: "Noto Sans Variable",
      fontWeight: "normal",
      fontSize: 22,
      text: roll.isCable ? "Cable Tag" : "Text",
      underline: false,
      overline: false,
      linethrough: false,
      textAlign: "center",
      fontStyle: "normal",
      lineHeight: 1,
      textBackgroundColor: "",
      charSpacing: 0,
      styles: [],
      direction: "ltr",
      path: null,
      pathStartOffset: 0,
      pathSide: "left",
      pathAlign: "baseline",
      minWidth: 20,
      splitByGrapheme: false,
    };

    return {
      barcode: roll.barcode,
      title: roll.name,
      label: labelProps,
      canvas: {
        version: "6.5.4",
        objects: [defaultObject as any],
      },
      timestamp: Date.now(),
    };
  }
}
