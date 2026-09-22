<script lang="ts">
  import { Utils } from "@mmote/niimbluelib";
  import BrowserWarning from "$/components/basic/BrowserWarning.svelte";
  import LabelDesigner from "$/components/LabelDesigner.svelte";
  import PrinterConnector from "$/components/PrinterConnector.svelte";
  import { locale, locales, tr } from "$/utils/i18n";
  import DebugStuff from "$/components/DebugStuff.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";

  import TemplateSelector from "$/components/designer-controls/TemplateSelector.svelte";

  // eslint-disable-next-line no-undef
  const appCommit = __APP_COMMIT__;
  // eslint-disable-next-line no-undef
  const buildDate = __BUILD_DATE__;

  let isStandalone = Utils.getAvailableTransports().capacitorBle || "__TAURI__" in window;

  let debugStuffShow = $state<boolean>(false);
</script>

<div class="page-wrapper d-flex flex-column min-vh-100">
  <div class="container my-2 flex-grow-1">
    <div class="row align-items-center mb-3 g-2">
      <div class="col-auto">
        <h1 class="title mb-0">
          <span class="niim">Niim</span><span class="blue">Bell</span>
        </h1>
      </div>
      <div class="col d-flex justify-content-start justify-content-md-center">
        <TemplateSelector />
      </div>
      <div class="col-auto">
        <PrinterConnector />
      </div>
    </div>
    <div class="row">
      <div class="col">
        <BrowserWarning />
      </div>
    </div>

    <div class="row">
      <div class="col">
        <LabelDesigner />
      </div>
    </div>
  </div>

  <div class="footer text-end text-secondary p-3">
    <div>
      <select class="form-select form-select-sm text-secondary d-inline-block w-auto" bind:value={$locale}>
        {#each Object.entries(locales) as [key, name] (key)}
          <option value={key}>{name}</option>
        {/each}
      </select>
    </div>
    <div>
      {#if appCommit}
        <a class="text-secondary" href="https://github.com/MultiMote/niimblue/commit/{appCommit}">
          {appCommit.slice(0, 6)}
        </a>
      {/if}
      {$tr("main.built")}
      {buildDate}
    </div>
    <div>
      <a class="text-secondary" href="https://github.com/MultiMote/niimblue">{$tr("main.code")}</a>
      <button class="text-secondary btn btn-link p-0" onclick={() => debugStuffShow = true}>
        <MdIcon icon="bug_report" />
      </button>
    </div>
  </div>
</div>

{#if debugStuffShow}
  <DebugStuff bind:show={debugStuffShow} />
{/if}

<style>
  .niim {
    color: #ff5349;
  }

  .blue {
    color: #0b7eff;
  }
</style>
