import { get, readable, writable } from "svelte/store";
import {
  AppConfigSchema,
  CsvParamsSchema,
  UserFontSchema,
  UserIconSchema,
  type CsvParams,
  type UserFont,
  type UserIcon,
  type AppConfig,
  type AutomationProps,
  type ConnectionState,
  type ConnectionType,
  type IdentifiedRoll,
  type ExportedLabelTemplate,
  ExportedLabelTemplateSchema,
} from "$/types";
import {
  NiimbotBluetoothClient,
  NiimbotCapacitorBleClient,
  NiimbotSerialClient,
  RequestCommandId,
  ResponseCommandId,
  Utils,
  instantiateClient,
  type HeartbeatData,
  type NiimbotAbstractClient,
  type PrinterInfo,
  type PrinterModelMeta,
  type RfidInfo,
} from "@mmote/niimbluelib";
import { Toasts } from "$/utils/toasts";
import { tr } from "$/utils/i18n";
import { LocalStoragePersistence, writablePersisted } from "$/utils/persistence";
import { APP_CONFIG_DEFAULTS, CSV_DEFAULT, OBJECT_DEFAULTS_TEXT } from "$/defaults";
import z from "zod";
import { FileUtils } from "$/utils/file_utils";
import { RfidIdentifier } from "$/utils/rfid_identifier";

export const fontCache = writable<string[]>([OBJECT_DEFAULTS_TEXT.fontFamily]);
export const appConfig = writablePersisted<AppConfig>("config", AppConfigSchema, APP_CONFIG_DEFAULTS);
export const userIcons = writablePersisted<UserIcon[]>("user_icons", z.array(UserIconSchema), []);
export const userFonts = writablePersisted<UserFont[]>("user_fonts", z.array(UserFontSchema), []);
export const loadedFonts = writable<FontFace[]>([]);

export const connectionState = writable<ConnectionState>("disconnected");
export const connectedPrinterName = writable<string>("");
export const printerClient = writable<NiimbotAbstractClient>();
export const heartbeatData = writable<HeartbeatData>();
export const printerInfo = writable<PrinterInfo>();
export const rfidInfo = writable<RfidInfo | undefined>();
export const ribbonRfidInfo = writable<RfidInfo | undefined>();
export const identifiedRoll = writable<IdentifiedRoll | undefined>();
export const detectedTemplates = writablePersisted<ExportedLabelTemplate[]>(
  "niimbell_detected_templates",
  z.array(ExportedLabelTemplateSchema),
  [],
);
export const activeTemplateRequest = writable<ExportedLabelTemplate | undefined>();
export const currentRollTemplate = writable<ExportedLabelTemplate | undefined>();
export const currentLabelExporter = writable<(() => ExportedLabelTemplate) | undefined>();
export const printerMeta = writable<PrinterModelMeta | undefined>();
export const heartbeatFails = writable<number>(0);
export const csvData = writablePersisted<CsvParams>("csv_params", CsvParamsSchema, { data: CSV_DEFAULT });

userFonts.subscribe(FileUtils.loadFonts);

export const automation = readable<AutomationProps | undefined>(
  (() => {
    try {
      return LocalStoragePersistence.loadAutomation() ?? undefined;
    } catch (e) {
      console.error(e);
    }
    return undefined;
  })(),
);

export const refreshRfidInfo = () => {
  const client = get(printerClient);

  if (!client) {
    return;
  }

  client.abstraction
    .rfidInfo()
    .then(async (info) => {
      rfidInfo.set(info);
      if (info && info.tagPresent && info.barCode) {
        const conf = get(appConfig);
        if (conf.rfidAutoIdentify !== false) {
          const roll = await RfidIdentifier.identify(info.barCode, info);
          identifiedRoll.set(roll);

          if (roll) {
            const templates = get(detectedTemplates);
            let tpl = templates.find((t) => t.barcode === roll.barcode);
            const meta = get(printerMeta);
            const printDir = meta?.printDirection ?? "left";

            if (!tpl) {
              tpl = RfidIdentifier.createDefaultTemplateForRoll(roll, printDir);
              detectedTemplates.update((list) => [...list, tpl!]);
              Toasts.message(`Created new template for ${roll.name}`);
            } else {
              Toasts.message(`Recalled template for ${roll.name}`);
            }

            currentRollTemplate.set(tpl);
            activeTemplateRequest.set(tpl);
          }
        }
      } else {
        identifiedRoll.set(undefined);
        currentRollTemplate.set(undefined);
      }
    })
    .catch(console.error);

  client.abstraction
    .rfidInfo2()
    .then(ribbonRfidInfo.set)
    .catch(() => {});
};

export const initClient = (connectionType: ConnectionType) => {
  printerClient.update((prevClient: NiimbotAbstractClient) => {
    let newClient: NiimbotAbstractClient = prevClient;

    if (
      prevClient === undefined ||
      (connectionType !== "bluetooth" && prevClient instanceof NiimbotBluetoothClient) ||
      (connectionType !== "serial" && prevClient instanceof NiimbotSerialClient) ||
      (connectionType !== "capacitor-ble" && prevClient instanceof NiimbotCapacitorBleClient)
    ) {
      if (prevClient !== undefined) {
        prevClient.disconnect();
      }

      newClient = instantiateClient(connectionType);

      const conf = get(appConfig);

      if (conf.packetIntervalMs !== undefined) {
        newClient.setPacketInterval(conf.packetIntervalMs);
      }

      newClient.on("packetsent", (e) => {
        console.log(`>> ${Utils.bufToHex(e.packet.toBytes())} (${RequestCommandId[e.packet.command]})`);
      });

      newClient.on("packetreceived", (e) => {
        console.log(`<< ${Utils.bufToHex(e.packet.toBytes())} (${ResponseCommandId[e.packet.command]})`);
      });

      newClient.on("connect", (e) => {
        console.log("onConnect");
        heartbeatFails.set(0);
        connectionState.set("connected");
        connectedPrinterName.set(e.info.deviceName ?? "unknown");
      });

      newClient.on("printerinfofetched", (e) => {
        console.log("printerInfoFetched");
        printerInfo.set(e.info);
        printerMeta.set(newClient.getModelMetadata());
      });

      newClient.on("disconnect", () => {
        console.log("onDisconnect");
        connectionState.set("disconnected");
        connectedPrinterName.set("");
        printerInfo.set({});
        printerMeta.set(undefined);
        rfidInfo.set(undefined);
        ribbonRfidInfo.set(undefined);
        identifiedRoll.set(undefined);
      });

      newClient.on("heartbeat", (e) => {
        heartbeatFails.set(0);
        heartbeatData.update((prev) => {
          if (
            prev?.paperRfidSuccess !== e.data?.paperRfidSuccess ||
            prev?.ribbonRfidSuccess !== e.data?.ribbonRfidSuccess
          ) {
            refreshRfidInfo();
          }
          return e.data;
        });
      });

      newClient.on("heartbeatfailed", (e) => {
        const maxFails = 5;
        heartbeatFails.set(e.failedAttempts);

        console.warn(`Heartbeat failed ${e.failedAttempts}/${maxFails}`);
        if (e.failedAttempts >= maxFails) {
          Toasts.error(get(tr)("connector.disconnect.heartbeat"));
          newClient.disconnect();
        }
      });
    }

    return newClient;
  });
};
