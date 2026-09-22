<script lang="ts">
  import {
    detectedTemplates,
    activeTemplateRequest,
    currentRollTemplate,
    identifiedRoll,
    currentLabelExporter,
    refreshRfidInfo,
    printerMeta,
    connectionState,
  } from "$/stores";
  import { RfidIdentifier } from "$/utils/rfid_identifier";
  import { Toasts } from "$/utils/toasts";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import Dropdown from "bootstrap/js/dist/dropdown";
  import type { ExportedLabelTemplate } from "$/types";

  let dropdownEl = $state<HTMLDivElement>();

  let activeTitle = $derived.by<string>(() => {
    if ($currentRollTemplate?.title) {
      return $currentRollTemplate.title;
    }
    if ($identifiedRoll?.name) {
      return $identifiedRoll.name;
    }
    if ($detectedTemplates.length > 0) {
      return $detectedTemplates[0].title ?? "Template Library";
    }
    return "Template Library";
  });

  const selectTemplate = (template: ExportedLabelTemplate) => {
    currentRollTemplate.set(template);
    activeTemplateRequest.set(template);
    Toasts.message(`Loaded: ${template.title ?? "Template"}`);
    if (dropdownEl) {
      new Dropdown(dropdownEl).hide();
    }
  };

  const deleteTemplate = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    const tpl = $detectedTemplates[index];
    if (confirm(`Remove "${tpl.title ?? "Template"}" from library?`)) {
      detectedTemplates.update((list) => list.filter((_, i) => i !== index));
      if ($currentRollTemplate?.barcode === tpl.barcode) {
        currentRollTemplate.set(undefined);
      }
      Toasts.message("Template removed from library");
    }
  };

  const saveCurrentToTemplate = () => {
    const exporter = $currentLabelExporter;
    if (!exporter) {
      Toasts.error("Canvas is not ready to export");
      return;
    }

    const currentData = exporter();
    const active = $currentRollTemplate;
    const barcode = active?.barcode ?? $identifiedRoll?.barcode;
    const title = active?.title ?? $identifiedRoll?.name ?? "Custom Roll Template";

    const updatedTemplate: ExportedLabelTemplate = {
      ...currentData,
      title,
      barcode,
    };

    detectedTemplates.update((list) => {
      const idx = list.findIndex((t) => (barcode && t.barcode === barcode) || t.title === title);
      if (idx >= 0) {
        const copy = [...list];
        copy[idx] = updatedTemplate;
        return copy;
      }
      return [...list, updatedTemplate];
    });

    currentRollTemplate.set(updatedTemplate);
    Toasts.message(`Saved changes to "${title}"`);
    if (dropdownEl) {
      new Dropdown(dropdownEl).hide();
    }
  };

  const saveAsNewTemplate = () => {
    const exporter = $currentLabelExporter;
    if (!exporter) {
      Toasts.error("Canvas is not ready to export");
      return;
    }

    const name = prompt("Enter a name for this new template:", $identifiedRoll?.name ?? "My Label Template");
    if (!name) return;

    const currentData = exporter();
    const newTemplate: ExportedLabelTemplate = {
      ...currentData,
      title: name,
      barcode: undefined,
    };

    detectedTemplates.update((list) => [...list, newTemplate]);
    currentRollTemplate.set(newTemplate);
    Toasts.message(`Added "${name}" to template library`);
    if (dropdownEl) {
      new Dropdown(dropdownEl).hide();
    }
  };

  const resetToRollDefaults = () => {
    if (!$identifiedRoll) {
      Toasts.error("No roll identified from printer");
      return;
    }

    const printDir = $printerMeta?.printDirection ?? "left";
    const defaultTpl = RfidIdentifier.createDefaultTemplateForRoll($identifiedRoll, printDir);

    detectedTemplates.update((list) => {
      const filtered = list.filter((t) => t.barcode !== $identifiedRoll!.barcode);
      return [...filtered, defaultTpl];
    });

    currentRollTemplate.set(defaultTpl);
    activeTemplateRequest.set(defaultTpl);
    Toasts.message(`Reset to default template for ${$identifiedRoll.name}`);
    if (dropdownEl) {
      new Dropdown(dropdownEl).hide();
    }
  };

  const getDimensionsText = (tpl: ExportedLabelTemplate): string => {
    const dpmm = 8;
    const wMm = Math.round(tpl.label.size.width / dpmm);
    const hMm = Math.round(tpl.label.size.height / dpmm);
    const tailMm = tpl.label.tailLength ? Math.round(tpl.label.tailLength / dpmm) : 0;
    if (tailMm > 0) {
      return `${hMm}×${wMm - tailMm}+${tailMm} mm`;
    }
    return `${wMm}×${hMm} mm`;
  };
</script>

<div class="dropdown template-selector-wrapper" bind:this={dropdownEl}>
  <button
    class="btn btn-outline-secondary dropdown-toggle d-flex align-items-center gap-2 text-truncate"
    type="button"
    data-bs-toggle="dropdown"
    data-bs-auto-close="outside"
    aria-expanded="false"
    title={activeTitle}
    style="max-width: 100%;">
    <MdIcon icon="style" />
    <span class="text-truncate template-name-display">{activeTitle}</span>
    <span class="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill ms-auto">
      {$detectedTemplates.length}
    </span>
    {#if $identifiedRoll}
      <span class="badge bg-success rounded-circle p-1" title="Roll in printer: {$identifiedRoll.name}">
        <span class="visually-hidden">Roll inserted</span>
      </span>
    {/if}
  </button>

  <div class="dropdown-menu dropdown-menu-end shadow-lg template-menu p-2" style="min-width: 320px; max-width: 440px;">
    <div class="d-flex justify-content-between align-items-center px-2 py-1 mb-1 border-bottom">
      <span class="fw-semibold small text-uppercase text-secondary">Library Templates</span>
      {#if $connectionState === "connected"}
        <button
          class="btn btn-sm btn-link text-decoration-none p-0 text-secondary"
          title="Re-read printer RFID tag"
          onclick={refreshRfidInfo}>
          <MdIcon icon="sync" /> Re-scan RFID
        </button>
      {/if}
    </div>

    <div class="template-list-scroll">
      {#if $detectedTemplates.length === 0}
        <div class="text-center text-muted p-3 small">
          <MdIcon icon="inventory_2" />
          <div class="mt-1">No saved roll templates yet.</div>
          <div class="text-secondary mt-1">Connect your printer with an RFID roll to automatically generate a template.</div>
        </div>
      {:else}
        {#each $detectedTemplates as tpl, idx (tpl.barcode ?? tpl.title ?? idx)}
          {@const isLoadedRoll = !!tpl.barcode && tpl.barcode === $identifiedRoll?.barcode}
          {@const isActive = tpl === $currentRollTemplate || (!!tpl.barcode && tpl.barcode === $currentRollTemplate?.barcode)}
          <div
            class="dropdown-item template-item rounded d-flex align-items-center justify-content-between py-2 px-2 my-1 {isActive ? 'active-template' : ''}"
            role="button"
            tabindex="0"
            onclick={() => selectTemplate(tpl)}
            onkeydown={(e) => e.key === 'Enter' && selectTemplate(tpl)}>
            <div class="d-flex flex-column text-truncate me-2">
              <div class="d-flex align-items-center gap-1">
                <span class="fw-medium text-truncate">{tpl.title ?? "Untitled"}</span>
                {#if isLoadedRoll}
                  <span class="badge bg-success-subtle text-success border border-success-subtle" title="Physically in printer">
                    In Printer
                  </span>
                {/if}
                {#if isActive}
                  <span class="badge bg-primary-subtle text-primary border border-primary-subtle">
                    Active
                  </span>
                {/if}
              </div>
              <div class="small text-secondary d-flex align-items-center gap-2 mt-1">
                <span>{getDimensionsText(tpl)}</span>
                {#if tpl.label.split === "vertical"}
                  <span class="badge bg-dark-subtle text-secondary border">Cable Flag</span>
                {/if}
                {#if tpl.barcode}
                  <span class="font-monospace text-muted">{tpl.barcode}</span>
                {/if}
              </div>
            </div>

            <button
              class="btn btn-sm btn-link text-danger p-1 delete-btn"
              title="Delete from library"
              onclick={(e) => deleteTemplate(e, idx)}>
              <MdIcon icon="delete" />
            </button>
          </div>
        {/each}
      {/if}
    </div>

    <div class="dropdown-divider my-2"></div>

    <div class="d-flex flex-column gap-1">
      <button class="btn btn-sm btn-outline-primary d-flex align-items-center gap-2 justify-content-center" onclick={saveCurrentToTemplate}>
        <MdIcon icon="save" /> Save Current Canvas to Template
      </button>

      <div class="d-flex gap-1 mt-1">
        <button class="btn btn-sm btn-outline-secondary flex-grow-1 d-flex align-items-center gap-1 justify-content-center" onclick={saveAsNewTemplate}>
          <MdIcon icon="add" /> Save as New...
        </button>

        {#if $identifiedRoll}
          <button class="btn btn-sm btn-outline-warning flex-grow-1 d-flex align-items-center gap-1 justify-content-center" onclick={resetToRollDefaults}>
            <MdIcon icon="restart_alt" /> Reset Roll
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .template-selector-wrapper {
    position: relative;
  }

  .template-name-display {
    max-width: 180px;
    font-weight: 500;
  }

  .template-list-scroll {
    max-height: 260px;
    overflow-y: auto;
  }

  .template-item {
    cursor: pointer;
    transition: background-color 0.15s ease-in-out;
  }

  .template-item:hover {
    background-color: var(--bs-tertiary-bg);
  }

  .active-template {
    background-color: var(--bs-secondary-bg);
    border-left: 3px solid var(--bs-primary);
  }

  .delete-btn {
    opacity: 0.5;
    transition: opacity 0.15s;
  }

  .template-item:hover .delete-btn {
    opacity: 1;
  }
</style>
