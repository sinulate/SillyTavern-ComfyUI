/* eslint-disable no-undef */
import { extension_settings, getContext } from "../../extensions.js";
import { saveSettingsDebounced, generateQuietPrompt, saveChat, reloadCurrentChat, eventSource, event_types, addOneMessage, getRequestHeaders, appendMediaToMessage } from "../../../script.js";
import { saveBase64AsFile } from "../../utils.js";
import { humanizedDateTime } from "../../RossAscends-mods.js";
import { Popup, POPUP_TYPE } from "../../popup.js";

const extensionName = "Image-gen-comfyui";
const extensionFolderPath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));

const VISUAL_DIRECTOR_PROTOCOL = `
[Visual Director Protocol]
At the end of every response, you must append a silent image generation prompt wrapped in <comfyui> tags. This prompt will drive a First-Person Perspective (POV) visualization of the scene via an Image-to-Image workflow using the character's avatar as a base.

Strictly adhere to the following Prompt Construction Rules:

1. PROXIMITY & SUBJECT (The "She" Rule)
   - The prompt MUST start with the word "She". Do not use the character's name.
   - Immediately establish distance from the viewer.
   - Prioritize the most recent output to determine the current action.

2. CHARACTER APPEARANCE & CONSISTENCY
   - Detailed Description: You must include relevant details about the character's eyes, hair, facial expression, and clothing.
   - Change Tracking: Specifically describe any clothing or physical changes that occurred in the scene.
   - Anatomy: Clearly describe the spatial relationship of visible anatomy (face, neck, chest, hips, arms, thighs, legs) relative to the viewer.

3. ACTION & FRAMING (The "Frame-Exit" Technique)
   - Rule 1: No Hands. Never mention "fingers" or "palms" unless absolutely necessary (e.g., clutching clothes).
   - Rule 2: Foreshortening. Use phrases like: "arms extended forward with extreme foreshortening."
   - Rule 3: Frame Exits. Describe limbs entering from the edge of the frame (e.g., "Right forearm reaches UPWARDS, cut off by the TOP edge").
   - Rule 4: Contact. If touching the viewer, describe hands "clutching the viewer's clothes" or "pressing against the lens" to anchor them.
   - Rule 5: Visibility. End this section confirming what is NOT visible (e.g., "Hands are not visible in the shot").

4. BACKGROUND & ENVIRONMENT
   - Qwen Optimization: The Qwen model requires high detail. Describe lighting (direction, shadows, sources), textures, and environmental objects precisely.
   - Consistency: Maintain background details from previous prompts unless the character has moved.

5. TECHNICAL DETAILS
   - Describe the viewer's POV (e.g., "Low angle looking up," "Eye level").
   - Use relevant quality tags (e.g., "8k, cinematic lighting, photorealistic").
`;

// --- UPDATED CONSTANTS (With Dscriptions) ---
const COMFYUI_PLACEHOLDERS = [
    { key: '"*input*"', desc: "Positive Prompt (Text)" },
    { key: '"*ninput*"', desc: "Negative Prompt (Text)" },
    { key: '"*seed*"', desc: "Seed (Integer)" },
    { key: '"*steps*"', desc: "Sampling Steps (Integer)" },
    { key: '"*cfg*"', desc: "CFG Scale (Float)" },
    { key: '"*denoise*"', desc: "Denoise Strength (Float)" },
    { key: '"*clip_skip*"', desc: "CLIP Skip (Integer)" },
    { key: '"*model*"', desc: "Checkpoint Name" },
    { key: '"*sampler*"', desc: "Sampler Name" },
    { key: '"*width*"', desc: "Image Width (px)" },
    { key: '"*height*"', desc: "Image Height (px)" },
    { key: '"*lora*"', desc: "LoRA 1 Filename" },
    { key: '"*lorawt*"', desc: "LoRA 1 Weight (Float)" },
    { key: '"*lora2*"', desc: "LoRA 2 Filename" },
    { key: '"*lorawt2*"', desc: "LoRA 2 Weight (Float)" },
    { key: '"*lora3*"', desc: "LoRA 3 Filename" },
    { key: '"*lorawt3*"', desc: "LoRA 3 Weight (Float)" },
    { key: '"*lora4*"', desc: "LoRA 4 Filename" },
    { key: '"*lorawt4*"', desc: "LoRA 4 Weight (Float)" }
];

const RESOLUTIONS = [
    { label: "1024 x 1024 (SDXL 1:1)", w: 1024, h: 1024 },
    { label: "1152 x 896 (SDXL Landscape)", w: 1152, h: 896 },
    { label: "896 x 1152 (SDXL Portrait)", w: 896, h: 1152 },
    { label: "1216 x 832 (SDXL Landscape)", w: 1216, h: 832 },
    { label: "832 x 1216 (SDXL Portrait)", w: 832, h: 1216 },
    { label: "1344 x 768 (SDXL Landscape)", w: 1344, h: 768 },
    { label: "768 x 1344 (SDXL Portrait)", w: 768, h: 1344 },
    { label: "512 x 512 (SD 1.5 1:1)", w: 512, h: 512 },
    { label: "768 x 512 (SD 1.5 Landscape)", w: 768, h: 512 },
    { label: "512 x 768 (SD 1.5 Portrait)", w: 512, h: 768 },
];

const defaultWorkflowData = {
  "3": { "inputs": { "seed": "*seed*", "steps": 20, "cfg": 7, "sampler_name": "*sampler*", "scheduler": "normal", "denoise": 1, "model": ["35", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
  "4": { "inputs": { "ckpt_name": "*model*" }, "class_type": "CheckpointLoaderSimple" },
  "5": { "inputs": { "width": "*width*", "height": "*height*", "batch_size": 1 }, "class_type": "EmptyLatentImage" },
  "6": { "inputs": { "text": "*input*", "clip": ["35", 1] }, "class_type": "CLIPTextEncode" },
  "7": { "inputs": { "text": "*ninput*", "clip": ["35", 1] }, "class_type": "CLIPTextEncode" },
  "8": { "inputs": { "samples": ["33", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
  "14": { "inputs": { "images": ["8", 0] }, "class_type": "PreviewImage" },
  "33": { "inputs": { "seed": "*seed*", "steps": 20, "cfg": 7, "sampler_name": "*sampler*", "scheduler": "normal", "denoise": 0.5, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["34", 0] }, "class_type": "KSampler" },
  "34": { "inputs": { "upscale_method": "nearest-exact", "scale_by": 1.2, "samples": ["3", 0] }, "class_type": "LatentUpscaleBy" },
  "35": { "inputs": { "lora_name": "*lora*", "strength_model": "*lorawt*", "strength_clip": "*lorawt*", "model": ["4", 0], "clip": ["4", 1] }, "class_type": "LoraLoader" }
};

const defaultSettings = {
    enabled: true,
    injectProtocol: true,
    debugPrompt: false,
    comfyUrl: "http://127.0.0.1:8188",
    connectionProfile: "",
    currentWorkflowName: "", // Server manages this now
    selectedModel: "",
    selectedLora: "",
    selectedLora2: "",
    selectedLora3: "",
    selectedLora4: "",
    selectedLoraWt: 1.0,
    selectedLoraWt2: 1.0,
    selectedLoraWt3: 1.0,
    selectedLoraWt4: 1.0,
    imgWidth: 1024,
    imgHeight: 1024,
    autoGenEnabled: false,
    autoGenFreq: 1,
    customNegative: "bad quality, blurry, worst quality, low quality",
    customSeed: -1,
    selectedSampler: "euler",
    compressImages: true,
    steps: 20,
    cfg: 7.0,
    denoise: 0.5,
    clipSkip: 1,
    profileStrategy: "current",
    promptStyle: "standard",
    promptPerspective: "scene",
    promptExtra: "",
    connectionProfile: "",
    savedWorkflowStates: {}
};

async function loadSettings() {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    for (const key in defaultSettings) {
        if (typeof extension_settings[extensionName][key] === 'undefined') {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }

    $("#comfyui_enable").prop("checked", extension_settings[extensionName].enabled);
    $("#comfyui_inject_protocol").prop("checked", extension_settings[extensionName].injectProtocol);
    $("#comfyui_debug").prop("checked", extension_settings[extensionName].debugPrompt);
    $("#comfyui_url").val(extension_settings[extensionName].comfyUrl);
    $("#comfyui_width").val(extension_settings[extensionName].imgWidth);
    $("#comfyui_height").val(extension_settings[extensionName].imgHeight);
    $("#comfyui_auto_enable").prop("checked", extension_settings[extensionName].autoGenEnabled);
    $("#comfyui_auto_freq").val(extension_settings[extensionName].autoGenFreq);

    $("#comfyui_prompt_style").val(extension_settings[extensionName].promptStyle || "standard");
    $("#comfyui_prompt_persp").val(extension_settings[extensionName].promptPerspective || "scene");
    $("#comfyui_prompt_extra").val(extension_settings[extensionName].promptExtra || "");

    $("#comfyui_lora_wt").val(extension_settings[extensionName].selectedLoraWt);
    $("#comfyui_lora_wt_display").text(extension_settings[extensionName].selectedLoraWt);
    $("#comfyui_lora_wt_2").val(extension_settings[extensionName].selectedLoraWt2);
    $("#comfyui_lora_wt_display_2").text(extension_settings[extensionName].selectedLoraWt2);
    $("#comfyui_lora_wt_3").val(extension_settings[extensionName].selectedLoraWt3);
    $("#comfyui_lora_wt_display_3").text(extension_settings[extensionName].selectedLoraWt3);
    $("#comfyui_lora_wt_4").val(extension_settings[extensionName].selectedLoraWt4);
    $("#comfyui_lora_wt_display_4").text(extension_settings[extensionName].selectedLoraWt4);

    $("#comfyui_negative").val(extension_settings[extensionName].customNegative);
    $("#comfyui_seed").val(extension_settings[extensionName].customSeed);
    $("#comfyui_compress").prop("checked", extension_settings[extensionName].compressImages);

	$("#comfyui_profile_strategy").val(extension_settings[extensionName].profileStrategy || "current");
    toggleProfileVisibility();

    updateSliderInput('comfyui_steps', 'comfyui_steps_val', extension_settings[extensionName].steps);
    updateSliderInput('comfyui_cfg', 'comfyui_cfg_val', extension_settings[extensionName].cfg);
    updateSliderInput('comfyui_denoise', 'comfyui_denoise_val', extension_settings[extensionName].denoise);
    updateSliderInput('comfyui_clip', 'comfyui_clip_val', extension_settings[extensionName].clipSkip);

    populateResolutions();
    populateProfiles();
    populateWorkflows();
    await fetchComfyLists();
}

function toggleProfileVisibility() {
    const strategy = extension_settings[extensionName].profileStrategy;

    // Always show the builder now!
    $("#comfyui_prompt_builder").show();

    // Only toggle the preset selector
    if (strategy === "specific") {
        $("#comfyui_profile").show();
    } else {
        $("#comfyui_profile").hide();
    }
}

function updateSliderInput(sliderId, numberId, value) {
    $(`#${sliderId}`).val(value);
    $(`#${numberId}`).val(value);
}

function populateResolutions() {
    const sel = $("#comfyui_resolution_list");
    sel.empty().append('<option value="">-- Select Preset --</option>');
    RESOLUTIONS.forEach((r, idx) => {
        sel.append(`<option value="${idx}">${r.label}</option>`);
    });
}

// --- WORKFLOW MANAGER ---
async function populateWorkflows() {
    const sel = $("#comfyui_workflow_list");
    sel.empty();
    sel.append('<option value="">-- Default Workflow --</option>'); // Always add Default option

    try {
        const response = await fetch('/api/sd/comfy/workflows', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: extension_settings[extensionName].comfyUrl }),
        });

        if (response.ok) {
            const workflows = await response.json();
            workflows.forEach(w => {
                sel.append(`<option value="${w}">${w}</option>`);
            });

            if (extension_settings[extensionName].currentWorkflowName) {
                if (workflows.includes(extension_settings[extensionName].currentWorkflowName)) {
                    sel.val(extension_settings[extensionName].currentWorkflowName);
                }
            }
        }
    } catch (e) {
        console.warn(`[${extensionName}] Failed to list workflows from server.`, e);
    }
}

async function onComfyNewWorkflowClick() {
    let name = await prompt("New workflow file name (e.g. 'my_flux.json'):");
    if (!name) return;
    if (!name.toLowerCase().endsWith('.json')) name += '.json';

    try {
        const res = await fetch('/api/sd/comfy/save-workflow', {
            method: 'POST', headers: getRequestHeaders(),
            body: JSON.stringify({ file_name: name, workflow: '{}' })
        });
        if (!res.ok) throw new Error(await res.text());
        toastr.success("Workflow created!");
        await populateWorkflows();
        $("#comfyui_workflow_list").val(name).trigger('change');
        setTimeout(onComfyOpenWorkflowEditorClick, 500);
    } catch (e) { toastr.error(e.message); }
}

async function onComfyDeleteWorkflowClick() {
    const name = extension_settings[extensionName].currentWorkflowName;
    if (!name) return;
    if (!confirm(`Delete ${name}?`)) return;

    try {
        const res = await fetch('/api/sd/comfy/delete-workflow', {
            method: 'POST', headers: getRequestHeaders(),
            body: JSON.stringify({ file_name: name })
        });
        if (!res.ok) throw new Error(await res.text());
        toastr.success("Deleted.");
        await populateWorkflows();
    } catch (e) { toastr.error(e.message); }
}

/* --- WORKFLOW STUDIO (Live Capture Fix) --- */
async function onComfyOpenWorkflowEditorClick() {
    const name = extension_settings[extensionName].currentWorkflowName;
    if (!name) return toastr.warning("No workflow selected");

    // 1. Load Data
    let loadedContent = "{}";
    try {
        const res = await fetch('/api/sd/comfy/workflow', {
            method: 'POST', headers: getRequestHeaders(),
            body: JSON.stringify({ file_name: name })
        });
        if (res.ok) {
            const rawBody = await res.json();
            let jsonObj = rawBody;
            if (typeof rawBody === 'string') {
                try { jsonObj = JSON.parse(rawBody); } catch(e) {}
            }
            loadedContent = JSON.stringify(jsonObj, null, 4);
        }
    } catch (e) { toastr.error("Failed to load file. Starting empty."); }

    // 2. Variable to hold the text in memory (Critical for saving)
    let currentJsonText = loadedContent;

    // --- UI BUILDER ---
    const $container = $(`
        <div style="display: flex; flex-direction: column; width: 100%; gap: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--smart-border-color); padding-bottom:10px;">
                <h3 style="margin:0;">${name}</h3>
                <div style="display:flex; gap:5px;">
                    <button class="menu_button wf-format" title="Beautify JSON"><i class="fa-solid fa-align-left"></i> Format</button>
                    <button class="menu_button wf-import" title="Upload .json file"><i class="fa-solid fa-upload"></i> Import</button>
                    <button class="menu_button wf-export" title="Download .json file"><i class="fa-solid fa-download"></i> Export</button>
                    <input type="file" class="wf-file-input" accept=".json" style="display:none;" />
                </div>
            </div>

            <div style="display: flex; gap: 15px;">
                <textarea class="text_pole wf-textarea" spellcheck="false"
                    style="flex: 1; min-height: 600px; height: 600px; font-family: 'Consolas', 'Monaco', monospace; white-space: pre; resize: none; font-size: 13px; padding: 10px; line-height: 1.4;"></textarea>

                <div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--smart-border-color); padding-left: 10px; max-height: 600px;">
                    <h4 style="margin: 0 0 10px 0; opacity:0.8;">Placeholders</h4>
                    <div class="wf-list" style="overflow-y: auto; flex: 1; padding-right: 5px;"></div>
                </div>
            </div>
            <small style="opacity:0.5;">Tip: Ensure your JSON is valid before saving.</small>
        </div>
    `);

    // --- LOGIC ---
    const $textarea = $container.find('.wf-textarea');
    const $list = $container.find('.wf-list');
    const $fileInput = $container.find('.wf-file-input');

    // Initialize UI
    $textarea.val(currentJsonText);

    // Sidebar Generator
    COMFYUI_PLACEHOLDERS.forEach(item => {
        const $itemDiv = $('<div></div>')
            .css({
                'padding': '8px 6px', 'margin-bottom': '6px', 'background-color': 'rgba(0,0,0,0.1)',
                'border-radius': '4px', 'font-family': 'monospace', 'font-size': '12px',
                'border': '1px solid transparent', 'transition': 'all 0.2s', 'cursor': 'text'
            });
        const $keySpan = $('<span></span>').text(item.key).css({'font-weight': 'bold', 'color': 'var(--smart-text-color)'});
        const $descSpan = $('<div></div>').text(item.desc).css({ 'font-size': '11px', 'opacity': '0.7', 'margin-top': '2px', 'font-family': 'sans-serif' });
        $itemDiv.append($keySpan).append($descSpan);
        $list.append($itemDiv);
    });

    // Highlighting & LIVE UPDATE Logic
    const updateState = () => {
        // 1. Capture text into memory variable
        currentJsonText = $textarea.val();

        // 2. Run Highlighting logic (Visuals)
        $list.children().each(function() {
            const cleanKey = $(this).find('span').first().text().replace(/"/g, '');
            if (currentJsonText.includes(cleanKey)) $(this).css({'border': '1px solid #4caf50', 'background-color': 'rgba(76, 175, 80, 0.1)'});
            else $(this).css({'border': '1px solid transparent', 'background-color': 'rgba(0,0,0,0.1)'});
        });
    };

    // Bind Input Listener to update variable immediately
    $textarea.on('input', updateState);
    setTimeout(updateState, 100);

    // Toolbar Actions
    $container.find('.wf-format').on('click', () => {
        try {
            const formatted = JSON.stringify(JSON.parse($textarea.val()), null, 4);
            $textarea.val(formatted);
            updateState(); // Update variable
            toastr.success("Formatted");
        } catch(e) { toastr.warning("Invalid JSON"); }
    });

    $container.find('.wf-import').on('click', () => $fileInput.click());
    $fileInput.on('change', (e) => {
        if (!e.target.files[0]) return;
        const r = new FileReader(); r.onload = (ev) => {
            $textarea.val(ev.target.result);
            updateState(); // Update variable
            toastr.success("Imported");
        };
        r.readAsText(e.target.files[0]); $fileInput.val('');
    });

    $container.find('.wf-export').on('click', () => {
        try { JSON.parse(currentJsonText); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([currentJsonText], {type:"application/json"})); a.download = name; a.click(); } catch(e) { toastr.warning("Invalid content"); }
    });

    // Validating Closure
    const onClosing = () => {
        try {
            JSON.parse(currentJsonText); // Validate the variable, not the UI
            return true;
        } catch (e) {
            toastr.error("Invalid JSON. Cannot save.");
            return false;
        }
    };

    const popup = new Popup($container, POPUP_TYPE.CONFIRM, '', { okButton: 'Save Changes', cancelButton: 'Cancel', wide: true, large: true, onClosing: onClosing });
    const confirmed = await popup.show();

    // SAVING
    if (confirmed) {
        try {
            console.log(`[${extensionName}] Saving workflow: ${name}`);
            // Minify
            const minified = JSON.stringify(JSON.parse(currentJsonText));
            const res = await fetch('/api/sd/comfy/save-workflow', {
                method: 'POST', headers: getRequestHeaders(),
                body: JSON.stringify({ file_name: name, workflow: minified })
            });

            if (!res.ok) throw new Error(await res.text());
            toastr.success("Workflow Saved!");
        } catch (e) {
            toastr.error("Save Failed: " + e.message);
        }
    }
}



// --- FETCH LISTS ---
async function fetchComfyLists() {
    const comfyUrl = extension_settings[extensionName].comfyUrl;
    const modelSel = $("#comfyui_model_list");
    const samplerSel = $("#comfyui_sampler_list");
    const loraSelectors = [ $("#comfyui_lora_list"), $("#comfyui_lora_list_2"), $("#comfyui_lora_list_3"), $("#comfyui_lora_list_4") ];

    try {
        const modelRes = await fetch('/api/sd/comfy/models', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: comfyUrl }) });
        if (modelRes.ok) {
            const models = await modelRes.json();
            modelSel.empty().append('<option value="">-- Select Model --</option>');
            models.forEach(m => {
                let val = (typeof m === 'object' && m !== null) ? m.value : m;
                let text = (typeof m === 'object' && m !== null && m.text) ? m.text : val;
                modelSel.append(`<option value="${val}">${text}</option>`);
            });
            if (extension_settings[extensionName].selectedModel) modelSel.val(extension_settings[extensionName].selectedModel);
        }

        const samplerRes = await fetch('/api/sd/comfy/samplers', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: comfyUrl }) });
        if (samplerRes.ok) {
            const samplers = await samplerRes.json();
            samplerSel.empty();
            samplers.forEach(s => samplerSel.append(`<option value="${s}">${s}</option>`));
            if (extension_settings[extensionName].selectedSampler) samplerSel.val(extension_settings[extensionName].selectedSampler);
        }

        const loraRes = await fetch(`${comfyUrl}/object_info/LoraLoader`);
        if (loraRes.ok) {
            const json = await loraRes.json();
            const files = json['LoraLoader'].input.required.lora_name[0];
            loraSelectors.forEach((sel, i) => {
                const k = i === 0 ? "selectedLora" : `selectedLora${i + 1}`;
                const v = extension_settings[extensionName][k];
                sel.empty().append('<option value="">-- No LoRA --</option>');
                files.forEach(f => sel.append(`<option value="${f}">${f}</option>`));
                if (v) sel.val(v);
            });
        }
    } catch (e) {
        console.warn(`[${extensionName}] Failed to fetch lists.`, e);
    }
}

async function onTestConnection() {
    const url = extension_settings[extensionName].comfyUrl;
    try {
        const result = await fetch('/api/sd/comfy/ping', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
        if (result.ok) {
            toastr.success("ComfyUI API connected!", "Image Gen ComfyUI");
            await fetchComfyLists();
        } else { throw new Error('ComfyUI returned an error via proxy.'); }
    } catch (error) { toastr.error(`Connection failed: ${error.message}`, "Image Gen ComfyUI"); }
}

/* --- UPDATED GENERATION LOGIC --- */
async function onGeneratePrompt() {
    if (!extension_settings[extensionName].enabled) return;
    const context = getContext();
    if (!context.chat || context.chat.length === 0) return toastr.warning("No chat history.");

    const strategy = extension_settings[extensionName].profileStrategy || "current";
    const requestProfile = extension_settings[extensionName].connectionProfile;
    const targetDropdown = $("#settings_preset_openai");
    const originalProfile = targetDropdown.val();
    let didSwitch = false;

    if (strategy === "specific" && requestProfile && requestProfile !== originalProfile && requestProfile !== "") {
        toastr.info(`Switching presets...`);
        targetDropdown.val(requestProfile).trigger("change");
        await new Promise(r => setTimeout(r, 1000));
        didSwitch = true;
    }

    // [START PROGRESS]
    showComfyUIProgress("Generating Prompt...");

    try {
        toastr.info("Visualizing...", "Image Gen ComfyUI");
        const lastMessage = context.chat[context.chat.length - 1].mes;
        const s = extension_settings[extensionName];

        const style = s.promptStyle || "standard";
        const persp = s.promptPerspective || "scene";
        const extra = s.promptExtra ? `, ${s.promptExtra}` : "";

        let styleInst = "", perspInst = "";
        if (style === "illustrious") styleInst = "Use Booru-style tags (e.g., 1girl, solo, blue hair). Focus on anime aesthetics.";
        else if (style === "sdxl") styleInst = "Use natural language sentences. Focus on photorealism and detailed textures.";
        else styleInst = "Use a list of detailed keywords/descriptors.";

        if (persp === "pov") perspInst = "Describe the scene from a First Person (POV) perspective, looking at the character.";
        else if (persp === "character") perspInst = "Focus intensely on the character's appearance and expression, ignoring background details.";
        else perspInst = "Describe the entire environment and atmosphere.";

        const instruction = `
            Task: Write an image generation prompt for the following scene.
            Scene: "${lastMessage}"
            Style Constraint: ${styleInst}
            Perspective: ${perspInst}
            Additional Req: ${extra}
            Output ONLY the prompt text.
            `;

        let generatedText = await generateQuietPrompt(instruction, true);

        if (didSwitch) {
            targetDropdown.val(originalProfile).trigger("change");
            await new Promise(r => setTimeout(r, 500));
        }

        if (s.debugPrompt) {
            // Hide progress while user is confirming
            hideComfyUIProgress();

            const $content = $(`
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <p><b>Review generated prompt:</b></p>
                    <textarea class="text_pole" rows="6" style="width:100%; resize:vertical; font-family:monospace;">${generatedText}</textarea>
                </div>
            `);
            let currentText = generatedText;
            $content.find("textarea").on("input", function() { currentText = $(this).val(); });
            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Diagnostic Mode", { okButton: "Send", cancelButton: "Stop" });
            const confirmed = await popup.show();

            if (!confirmed) {
                toastr.info("Generation stopped by user.");
                return;
            }
            generatedText = currentText;
            // Show progress again
            showComfyUIProgress("Sending to ComfyUI...");
        }

        // Update progress text
        showComfyUIProgress("Sending to ComfyUI...");
        await generateWithComfy(generatedText, null);

    } catch (err) {
        // [HIDE PROGRESS ON ERROR]
        hideComfyUIProgress();
        if (didSwitch) targetDropdown.val(originalProfile).trigger("change");
        console.error(err);
        toastr.error("Generation failed. Check console.");
    }
}

async function generateWithComfy(positivePrompt, target = null) {
    const url = extension_settings[extensionName].comfyUrl;
    const currentName = extension_settings[extensionName].currentWorkflowName;

    // Load from server or fallback
    let workflowRaw;
    try {
        if (!currentName) throw new Error("No workflow selected");
        const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: currentName }) });
        if (!res.ok) throw new Error("Load failed");
        workflowRaw = await res.json();
    } catch (e) {
        console.warn(`[${extensionName}] Failed to load workflow from server. Using default.`, e);
        workflowRaw = JSON.parse(JSON.stringify(defaultWorkflowData));
    }

    let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;

    // Safety check for workflow
    if (!workflow || typeof workflow !== 'object') {
        toastr.error("Invalid workflow data.");
        return;
    }

    let finalSeed = parseInt(extension_settings[extensionName].customSeed);
    if (finalSeed === -1 || isNaN(finalSeed)) {
        finalSeed = Math.floor(Math.random() * 1000000000);
    }

    workflow = injectParamsIntoWorkflow(workflow, positivePrompt, finalSeed);

    try {
        toastr.info("Sending to ComfyUI...", "Image Gen ComfyUI");
        const res = await fetch(`${url}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
        if(!res.ok) throw new Error("Failed");
        const data = await res.json();
        await waitForGeneration(url, data.prompt_id, positivePrompt, target);
    } catch(e) { toastr.error("Comfy Error: " + e.message); }
}

function injectParamsIntoWorkflow(workflow, promptText, finalSeed) {
    const s = extension_settings[extensionName];
    let seedInjected = false;

    if (!workflow) return {};

    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node && node.inputs) {
            for (const key in node.inputs) {
                const val = node.inputs[key];

                if (val === "*input*") node.inputs[key] = promptText;
                if (val === "*ninput*") node.inputs[key] = s.customNegative || "";
                if (val === "*seed*") { node.inputs[key] = finalSeed; seedInjected = true; }
                if (val === "*sampler*") node.inputs[key] = s.selectedSampler || "euler";
                if (val === "*model*") node.inputs[key] = s.selectedModel || "v1-5-pruned.ckpt";

                if (val === "*steps*") node.inputs[key] = parseInt(s.steps) || 20;
                if (val === "*cfg*") node.inputs[key] = parseFloat(s.cfg) || 7.0;
                if (val === "*denoise*") node.inputs[key] = parseFloat(s.denoise) || 1.0;
                if (val === "*clip_skip*") node.inputs[key] = -Math.abs(parseInt(s.clipSkip)) || -1;

                if (val === "*lora*") node.inputs[key] = s.selectedLora || "None";
                if (val === "*lora2*") node.inputs[key] = s.selectedLora2 || "None";
                if (val === "*lora3*") node.inputs[key] = s.selectedLora3 || "None";
                if (val === "*lora4*") node.inputs[key] = s.selectedLora4 || "None";
                if (val === "*lorawt*") node.inputs[key] = parseFloat(s.selectedLoraWt) || 1.0;
                if (val === "*lorawt2*") node.inputs[key] = parseFloat(s.selectedLoraWt2) || 1.0;
                if (val === "*lorawt3*") node.inputs[key] = parseFloat(s.selectedLoraWt3) || 1.0;
                if (val === "*lorawt4*") node.inputs[key] = parseFloat(s.selectedLoraWt4) || 1.0;

                if (val === "*width*") node.inputs[key] = parseInt(s.imgWidth) || 512;
                if (val === "*height*") node.inputs[key] = parseInt(s.imgHeight) || 512;
            }
            if (!seedInjected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') {
               node.inputs.seed = finalSeed;
            }
        }
    }
    return workflow;
}

async function onImageSwiped(data) {
    if (!extension_settings[extensionName].enabled) return;
    const { message, direction, element } = data;
    const context = getContext();
    const settings = context.powerUserSettings || window.power_user;

    if (direction !== "right") return;
    if (settings && settings.image_overswipe !== "generate") return;
    if (message.name !== "Image Gen ComfyUI" && message.name !== "Image Gen Kazuma") return;

    const media = message.extra?.media || [];
    const idx = message.extra?.media_index || 0;

    if (idx < media.length - 1) return;

    const mediaObj = media[idx];
    if (!mediaObj || !mediaObj.title) return;

    const prompt = mediaObj.title;
    toastr.info("New variation...", "Image Gen ComfyUI");
    await generateWithComfy(prompt, { message: message, element: $(element) });
}

async function waitForGeneration(baseUrl, promptId, positivePrompt, target) {
     // [UPDATE TEXT]
     showComfyUIProgress("Rendering Image...");

     const checkInterval = setInterval(async () => {
        try {
            const h = await (await fetch(`${baseUrl}/history/${promptId}`)).json();
            if (h[promptId]) {
                clearInterval(checkInterval);
                const outputs = h[promptId].outputs;
                let finalImage = null;
                for (const nodeId in outputs) {
                    const nodeOutput = outputs[nodeId];
                    if (nodeOutput.images && nodeOutput.images.length > 0) {
                        finalImage = nodeOutput.images[0];
                        break;
                    }
                }
                if (finalImage) {
                    // [UPDATE TEXT]
                    showComfyUIProgress("Downloading...");

                    const imgUrl = `${baseUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;
                    await insertImageToChat(imgUrl, positivePrompt, target);

                    // [HIDE WHEN DONE]
                    hideComfyUIProgress();
                } else {
                    hideComfyUIProgress();
                }
            }
        } catch (e) { }
    }, 1000);
}

function blobToBase64(blob) { return new Promise((resolve) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.readAsDataURL(blob); }); }

function compressImage(base64Str, quality = 0.9) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => resolve(base64Str);
    });
}

// --- SAVE TO SERVER ---
async function insertImageToChat(imgUrl, promptText, target = null) {
    try {
        toastr.info("Downloading image...", "Image Gen ComfyUI");
        const response = await fetch(imgUrl);
        const blob = await response.blob();
        let base64FullURL = await blobToBase64(blob);

        let format = "png";
        if (extension_settings[extensionName].compressImages) {
            base64FullURL = await compressImage(base64FullURL, 0.9);
            format = "jpeg";
        }

        const base64Raw = base64FullURL.split(',')[1];
        const context = getContext();
        let characterName = "User";
        if (context.groupId) {
            characterName = context.groups.find(x => x.id === context.groupId)?.id;
        } else if (context.characterId) {
            characterName = context.characters[context.characterId]?.name;
        }
        if (!characterName) characterName = "User";

        const filename = `${characterName}_${humanizedDateTime()}`;
        const savedPath = await saveBase64AsFile(base64Raw, characterName, filename, format);

        const mediaAttachment = {
            url: savedPath,
            type: "image",
            source: "generated",
            title: promptText,
            generation_type: "free",
        };

        if (target && target.message) {
            if (!target.message.extra) target.message.extra = {};
            if (!target.message.extra.media) target.message.extra.media = [];
            target.message.extra.media_display = "gallery";
            target.message.extra.media.push(mediaAttachment);
            target.message.extra.media_index = target.message.extra.media.length - 1;
            if (typeof appendMediaToMessage === "function") appendMediaToMessage(target.message, target.element);
            await saveChat();
            toastr.success("Gallery updated!");
        } else {
            const newMessage = {
                name: "Image Gen ComfyUI", is_user: false, is_system: true, send_date: Date.now(),
                mes: "", extra: { media: [mediaAttachment], media_display: "gallery", media_index: 0, inline_image: false }, force_avatar: "img/five.png"
            };
            context.chat.push(newMessage);
            await saveChat();
            if (typeof addOneMessage === "function") addOneMessage(newMessage);
            else await reloadCurrentChat();
            toastr.success("Image inserted!");
        }

    } catch (err) { console.error(err); toastr.error("Failed to save/insert image."); }
}

// --- INIT ---
jQuery(async () => {
    try {
        // 1. INJECT PROGRESS BAR HTML (New Code Here)
        if ($("#comfyui_progress_overlay").length === 0) {
            $("body").append(`
                <div id="comfyui_progress_overlay">
                    <div style="flex:1">
                        <span id="comfyui_progress_text">Generating Image...</span>
                        <div class="comfyui-bar-container">
                            <div class="comfyui-bar-fill"></div>
                        </div>
                    </div>
                </div>
            `);
        }

        // 2. Load Settings & Bind Events
        await $.get(`${extensionFolderPath}/example.html`).then(h => $("#extensions_settings2").append(h));

        $("#comfyui_enable").on("change", (e) => { extension_settings[extensionName].enabled = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#comfyui_inject_protocol").on("change", (e) => { extension_settings[extensionName].injectProtocol = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#comfyui_debug").on("change", (e) => { extension_settings[extensionName].debugPrompt = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#comfyui_url").on("input", (e) => { extension_settings[extensionName].comfyUrl = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_profile").on("change", (e) => { extension_settings[extensionName].connectionProfile = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_auto_enable").on("change", (e) => { extension_settings[extensionName].autoGenEnabled = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#comfyui_auto_freq").on("input", (e) => { let v = parseInt($(e.target).val()); if(v<1)v=1; extension_settings[extensionName].autoGenFreq = v; saveSettingsDebounced(); });

        // SMART WORKFLOW SWITCHER
        $("#comfyui_workflow_list").on("change", (e) => {
            const newWorkflow = $(e.target).val();
            const oldWorkflow = extension_settings[extensionName].currentWorkflowName;

            // 1. Snapshot OLD workflow settings
            if (oldWorkflow) {
                if (!extension_settings[extensionName].savedWorkflowStates) extension_settings[extensionName].savedWorkflowStates = {};
                extension_settings[extensionName].savedWorkflowStates[oldWorkflow] = getWorkflowState();
                console.log(`[${extensionName}] Saved context for ${oldWorkflow}`);
            }

            // 2. Load NEW workflow settings (if they exist)
            if (extension_settings[extensionName].savedWorkflowStates && extension_settings[extensionName].savedWorkflowStates[newWorkflow]) {
                applyWorkflowState(extension_settings[extensionName].savedWorkflowStates[newWorkflow]);
                toastr.success(`Restored settings for ${newWorkflow}`);
            } else {
                // If no saved state, we keep current values (Inheritance) - smoother UX
                toastr.info(`New workflow context active`);
            }

            // 3. Update Pointer
            extension_settings[extensionName].currentWorkflowName = newWorkflow;
            saveSettingsDebounced();
        });
        $("#comfyui_import_btn").on("click", () => $("#comfyui_import_file").click());

        // New Logic Events
        $("#comfyui_prompt_style").on("change", (e) => { extension_settings[extensionName].promptStyle = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_prompt_persp").on("change", (e) => { extension_settings[extensionName].promptPerspective = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_prompt_extra").on("input", (e) => { extension_settings[extensionName].promptExtra = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_profile_strategy").on("change", (e) => {
            extension_settings[extensionName].profileStrategy = $(e.target).val();
            toggleProfileVisibility();
            saveSettingsDebounced();
        });

        $("#comfyui_new_workflow").on("click", onComfyNewWorkflowClick);
        $("#comfyui_edit_workflow").on("click", onComfyOpenWorkflowEditorClick);
        $("#comfyui_delete_workflow").on("click", onComfyDeleteWorkflowClick);

        $("#comfyui_model_list").on("change", (e) => { extension_settings[extensionName].selectedModel = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_sampler_list").on("change", (e) => { extension_settings[extensionName].selectedSampler = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_resolution_list").on("change", (e) => {
            const idx = parseInt($(e.target).val());
            if (!isNaN(idx) && RESOLUTIONS[idx]) {
                const r = RESOLUTIONS[idx];
                $("#comfyui_width").val(r.w).trigger("input");
                $("#comfyui_height").val(r.h).trigger("input");
            }
        });

        $("#comfyui_lora_list").on("change", (e) => { extension_settings[extensionName].selectedLora = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_lora_list_2").on("change", (e) => { extension_settings[extensionName].selectedLora2 = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_lora_list_3").on("change", (e) => { extension_settings[extensionName].selectedLora3 = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_lora_list_4").on("change", (e) => { extension_settings[extensionName].selectedLora4 = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_lora_wt").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt = v; $("#comfyui_lora_wt_display").text(v); saveSettingsDebounced(); });
        $("#comfyui_lora_wt_2").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt2 = v; $("#comfyui_lora_wt_display_2").text(v); saveSettingsDebounced(); });
        $("#comfyui_lora_wt_3").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt3 = v; $("#comfyui_lora_wt_display_3").text(v); saveSettingsDebounced(); });
        $("#comfyui_lora_wt_4").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt4 = v; $("#comfyui_lora_wt_display_4").text(v); saveSettingsDebounced(); });

        $("#comfyui_width, #comfyui_height").on("input", (e) => { extension_settings[extensionName][e.target.id === "comfyui_width" ? "imgWidth" : "imgHeight"] = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#comfyui_negative").on("input", (e) => { extension_settings[extensionName].customNegative = $(e.target).val(); saveSettingsDebounced(); });
        $("#comfyui_seed").on("input", (e) => { extension_settings[extensionName].customSeed = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#comfyui_compress").on("change", (e) => { extension_settings[extensionName].compressImages = $(e.target).prop("checked"); saveSettingsDebounced(); });

        function bindSlider(id, key, isFloat = false) {
            $(`#${id}`).on("input", function() {
                let v = isFloat ? parseFloat(this.value) : parseInt(this.value);
                extension_settings[extensionName][key] = v;
                $(`#${id}_val`).val(v);
                saveSettingsDebounced();
            });
            $(`#${id}_val`).on("input", function() {
                let v = isFloat ? parseFloat(this.value) : parseInt(this.value);
                extension_settings[extensionName][key] = v;
                $(`#${id}`).val(v);
                saveSettingsDebounced();
            });
        }
        bindSlider("comfyui_steps", "steps", false);
        bindSlider("comfyui_cfg", "cfg", true);
        bindSlider("comfyui_denoise", "denoise", true);
        bindSlider("comfyui_clip", "clipSkip", false);

        $("#comfyui_test_btn").on("click", onTestConnection);
        $("#comfyui_gen_prompt_btn").on("click", onGeneratePrompt);

        loadSettings();
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.IMAGE_SWIPED, onImageSwiped);
        if (event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
        }
        if (event_types.TEXT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.TEXT_COMPLETION_PROMPT_READY, onTextCompletionPromptReady);
        }

        let att = 0; const int = setInterval(() => { if ($("#comfyui_quick_gen").length > 0) { clearInterval(int); return; } createChatButton(); att++; if (att > 5) clearInterval(int); }, 1000);
        $(document).on("click", "#comfyui_quick_gen", function(e) { e.preventDefault(); e.stopPropagation(); onGeneratePrompt(); });

        // Manual Scan Button Handler
        $("#comfyui_manual_scan_btn").on("click", onScanLastMessage);

    } catch (e) { console.error(e); }
});

// Helpers (Condensed)
/* --- MANUAL SCAN FOR DEBUG --- */
async function onScanLastMessage() {
    toastr.info("Scanning last message for tags...", "ComfyUI");
    const context = getContext();
    const chat = context.chat;
    if (!chat || !chat.length) return toastr.warning("No chat messages.");

    // Pass the index of the last message
    await onMessageReceived(chat.length - 1);
}

/* --- NEW INJECTION LISTENER --- */
async function onMessageReceived(id) {
    // 1. Basic Safety Checks
    if (!extension_settings[extensionName].enabled) return;

    // WAIT for streaming to finish / UI to settle
    setTimeout(async () => {
        const context = getContext();
        const chat = context.chat;
        if (!chat || !chat.length) return;

        // Get the message (robustly)
        let msgIndex = -1;
        if (typeof id !== 'undefined' && chat[id]) {
            msgIndex = id;
        } else {
            msgIndex = chat.length - 1;
        }

        let message = chat[msgIndex];

        // Ignore User messages (we only want to generate from AI output)
        if (message.is_user) return;

        console.log(`[${extensionName}] Analyzing message ${msgIndex} for tags... Content length: ${message.mes.length}`);

        // 2. THE DETECTION LOGIC (Regex)
        // Relaxed regex: case insensitive, handles potential spaces
        const regex = /<comfyui\s*>([\s\S]*?)<\/comfyui>/i;
        const match = message.mes.match(regex);

        if (match) {
            console.log(`[${extensionName}] ✅ Injection Tag Detected!`);
            toastr.info("Visual Director instruction found. Generating...", "ComfyUI");

            // 3. EXTRACTION
            const extractedPrompt = match[1].trim();

            if (!extractedPrompt) {
                console.warn(`[${extensionName}] Empty prompt inside <comfyui> tags.`);
                return;
            }

            // 4. THE "ACTIVE HIDE"
            const cleanMessage = message.mes.replace(match[0], "").trim();

            // Update the message in memory
            chat[msgIndex].mes = cleanMessage;

            // Save to SillyTavern storage
            await saveChat();

            // Force a UI refresh so the tag disappears from your screen immediately
            if (typeof reloadCurrentChat === "function") {
                await reloadCurrentChat();
            }

            // 5. EXECUTION
            console.log(`[${extensionName}] Sending extracted prompt to ComfyUI: "${extractedPrompt.substring(0, 50)}..."`);
            await generateWithComfy(extractedPrompt, null);
        }
        else {
            console.log(`[${extensionName}] ❌ No <comfyui> tag found in message.`);
        }
    }, 500); // 500ms delay
}

function createChatButton() { if ($("#comfyui_quick_gen").length > 0) return; const b = `<div id="comfyui_quick_gen" class="interactable" title="Visualize" style="cursor: pointer; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; margin-right: 5px; opacity: 0.7;"><i class="fa-solid fa-paintbrush fa-lg"></i></div>`; let t = $("#send_but_sheld"); if (!t.length) t = $("#send_textarea"); if (t.length) { t.attr("id") === "send_textarea" ? t.before(b) : t.prepend(b); } }
function populateProfiles() { const s=$("#comfyui_profile"),o=$("#settings_preset_openai").find("option");s.empty().append('<option value="">-- Use Current Settings --</option>');if(o.length)o.each(function(){s.append(`<option value="${$(this).val()}">${$(this).text()}</option>`)});if(extension_settings[extensionName].connectionProfile)s.val(extension_settings[extensionName].connectionProfile);}
async function onFileSelected(e) { const f=e.target.files[0];if(!f)return;const t=await f.text();try{const j=JSON.parse(t),n=prompt("Name:",f.name.replace(".json",""));if(n){extension_settings[extensionName].savedWorkflows[n]=j;extension_settings[extensionName].currentWorkflowName=n;saveSettingsDebounced();populateWorkflows();}}catch{toastr.error("Invalid JSON");}$(e.target).val('');}
function showComfyUIProgress(text = "Processing...") {
    $("#comfyui_progress_text").text(text);
    $("#comfyui_progress_overlay").css("display", "flex");
}

function hideComfyUIProgress() {
    $("#comfyui_progress_overlay").hide();
}
/* --- WORKFLOW CONTEXT MANAGERS --- */
function getWorkflowState() {
    const s = extension_settings[extensionName];
    // Capture all image-related parameters
    return {
        selectedModel: s.selectedModel,
        selectedSampler: s.selectedSampler,
        steps: s.steps,
        cfg: s.cfg,
        denoise: s.denoise,
        clipSkip: s.clipSkip,
        imgWidth: s.imgWidth,
        imgHeight: s.imgHeight,
        customSeed: s.customSeed,
        customNegative: s.customNegative,
        // Smart Prompts
        promptStyle: s.promptStyle,
        promptPerspective: s.promptPerspective,
        promptExtra: s.promptExtra,
        // LoRAs
        selectedLora: s.selectedLora, selectedLoraWt: s.selectedLoraWt,
        selectedLora2: s.selectedLora2, selectedLoraWt2: s.selectedLoraWt2,
        selectedLora3: s.selectedLora3, selectedLoraWt3: s.selectedLoraWt3,
        selectedLora4: s.selectedLora4, selectedLoraWt4: s.selectedLoraWt4,
    };
}

function applyWorkflowState(state) {
    const s = extension_settings[extensionName];
    // 1. Update Global Settings
    Object.assign(s, state);

    // 2. Update UI Elements
    $("#comfyui_model_list").val(s.selectedModel);
    $("#comfyui_sampler_list").val(s.selectedSampler);

    updateSliderInput('comfyui_steps', 'comfyui_steps_val', s.steps);
    updateSliderInput('comfyui_cfg', 'comfyui_cfg_val', s.cfg);
    updateSliderInput('comfyui_denoise', 'comfyui_denoise_val', s.denoise);
    updateSliderInput('comfyui_clip', 'comfyui_clip_val', s.clipSkip);

    $("#comfyui_width").val(s.imgWidth);
    $("#comfyui_height").val(s.imgHeight);
    $("#comfyui_seed").val(s.customSeed);
    $("#comfyui_negative").val(s.customNegative);

    // Smart Prompt UI
    $("#comfyui_prompt_style").val(s.promptStyle || "standard");
    $("#comfyui_prompt_persp").val(s.promptPerspective || "scene");
    $("#comfyui_prompt_extra").val(s.promptExtra || "");

    // LoRA UI
    $("#comfyui_lora_list").val(s.selectedLora);
    $("#comfyui_lora_list_2").val(s.selectedLora2);
    $("#comfyui_lora_list_3").val(s.selectedLora3);
    $("#comfyui_lora_list_4").val(s.selectedLora4);

    // LoRA Weights UI
    $("#comfyui_lora_wt").val(s.selectedLoraWt); $("#comfyui_lora_wt_display").text(s.selectedLoraWt);
    $("#comfyui_lora_wt_2").val(s.selectedLoraWt2); $("#comfyui_lora_wt_display_2").text(s.selectedLoraWt2);
    $("#comfyui_lora_wt_3").val(s.selectedLoraWt3); $("#comfyui_lora_wt_display_3").text(s.selectedLoraWt3);
    $("#comfyui_lora_wt_4").val(s.selectedLoraWt4); $("#comfyui_lora_wt_display_4").text(s.selectedLoraWt4);
}

/* --- PROMPT INJECTION --- */
function onChatCompletionPromptReady(data) {
    if (!extension_settings[extensionName].enabled) return;
    if (!extension_settings[extensionName].injectProtocol) {
        // Warn if user expects images but injection is off
        if (extension_settings[extensionName].autoGenEnabled) {
            toastr.warning("Auto-Gen enabled but Injection is OFF. The model won't know how to generate images.", "ComfyUI");
        }
        return;
    }

    if (data && typeof data.system_prompt === "string") {
        console.log(`[${extensionName}] 💉 Injecting Visual Director Protocol to System Prompt...`);
        // Append with a newline to separate from existing prompt
        data.system_prompt += "\n" + VISUAL_DIRECTOR_PROTOCOL;
    }
}

function onTextCompletionPromptReady(data) {
    if (!extension_settings[extensionName].enabled) return;
    if (!extension_settings[extensionName].injectProtocol) return;

    if (data && typeof data.prompt === "string") {
        console.log(`[${extensionName}] Injecting Visual Director Protocol to Text Prompt...`);
        // Prepend or Append? For system instructions in text completion, usually defined in Story String.
        // But simply appending to the very end might act as a User message or System note depending on formatting.
        // Safest is to append with a clear separator or try to inject before the last line.
        // However, appending to data.prompt affects the final string sent to backend.

        // We'll append it with a newline.
        data.prompt += "\n" + VISUAL_DIRECTOR_PROTOCOL;
    }
}
