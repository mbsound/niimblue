import type { IdentifiedRoll, LabelProps, LabelShape } from "$/types";
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
   */
  public static calculateLabelProps(
    roll: IdentifiedRoll,
    printDirection: PrintDirection,
    dpmm: number = 8
  ): Partial<LabelProps> {
    const dim1 = roll.width;
    const dim2 = roll.height;

    const tapeWidth = Math.min(dim1, dim2);
    const feedLength = Math.max(dim1, dim2);

    let canvasWidthMm = feedLength;
    let canvasHeightMm = tapeWidth;

    if (printDirection === "top") {
      canvasWidthMm = feedLength;
      canvasHeightMm = tapeWidth;
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

    return {
      printDirection,
      size: {
        width: widthPx,
        height: heightPx,
      },
      shape,
    };
  }
}
