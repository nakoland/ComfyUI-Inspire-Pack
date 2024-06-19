import { ComfyApp, app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

let get_wildcards_list;
try {
    const ImpactPack = await import("../ComfyUI-Impact-Pack/impact-pack.js");
    get_wildcards_list = ImpactPack.get_wildcards_list;
} catch (error) {}

// fallback
if (!get_wildcards_list) {
    get_wildcards_list = () => { return ["Impact Pack isn't installed or is outdated."]; }
}

let pb_cache = {};

async function get_prompt_builder_items(category) {
    if (pb_cache[category])
        return pb_cache[category];
    else {
        let res = await api.fetchApi(`/inspire/prompt_builder?category=${category}`);
        let data = await res.json();
        pb_cache[category] = data.presets;
        return data.presets;
    }
}

// 프리셋 파일 경로에서 제목을 불러오는 함수
async function fetchPresetTitles() {
    try {
        const response = await fetch("/inspire/preset_titles");
        if (!response.ok) throw new Error("Failed to fetch preset titles");
        const titles = await response.json();
        return titles;
    } catch (error) {
        console.error("Error fetching preset titles:", error);
        return [];
    }
}

// 프리셋 파일 경로에서 내용을 불러오는 함수
async function fetchPresetContent(title) {
    try {
        const response = await fetch(`/inspire/preset_content?title=${encodeURIComponent(title)}`);
        if (!response.ok) throw new Error(`Failed to fetch content for title: ${title}`);
        const data = await response.json();
        return data.content;
    } catch (error) {
        console.error("Error fetching preset content:", error);
        return "";
    }
}


app.registerExtension({
    name: "Comfy.Inspire.Prompts",

    nodeCreated(node, app) {
        if (node.comfyClass == "WildcardEncode //Inspire") {
            const wildcard_text_widget_index = node.widgets.findIndex((w) => w.name == 'wildcard_text');
            const populated_text_widget_index = node.widgets.findIndex((w) => w.name == 'populated_text');
            const mode_widget_index = node.widgets.findIndex((w) => w.name == 'mode');

            const wildcard_text_widget = node.widgets[wildcard_text_widget_index];
            const populated_text_widget = node.widgets[populated_text_widget_index];

            // lora selector, wildcard selector
            let combo_id = 5;

            Object.defineProperty(node.widgets[combo_id], "value", {
                set: (value) => {
                    const stackTrace = new Error().stack;
                    if (stackTrace.includes('inner_value_change')) {
                        if (value != "Select the LoRA to add to the text") {
                            let lora_name = value;
                            if (lora_name.endsWith('.safetensors')) {
                                lora_name = lora_name.slice(0, -12);
                            }

                            wildcard_text_widget.value += `<lora:${lora_name}>`;
                        }
                    }
                },
                get: () => { return "Select the LoRA to add to the text"; }
            });

            Object.defineProperty(node.widgets[combo_id + 1], "value", {
                set: (value) => {
                    const stackTrace = new Error().stack;
                    if (stackTrace.includes('inner_value_change')) {
                        if (value != "Select the Wildcard to add to the text") {
                            if (wildcard_text_widget.value != '')
                                wildcard_text_widget.value += ', '

                            wildcard_text_widget.value += value;
                        }
                    }
                },
                get: () => { return "Select the Wildcard to add to the text"; }
            });

            Object.defineProperty(node.widgets[combo_id + 1].options, "values", {
                set: (x) => { },
                get: () => {
                    return get_wildcards_list();
                }
            });

            // Preventing validation errors from occurring in any situation.
            node.widgets[combo_id].serializeValue = () => { return "Select the LoRA to add to the text"; }
            node.widgets[combo_id + 1].serializeValue = () => { return "Select the Wildcard to add to the text"; }

            // wildcard populating
            populated_text_widget.inputEl.disabled = true;
            const mode_widget = node.widgets[mode_widget_index];

            // mode combo
            Object.defineProperty(mode_widget, "value", {
                set: (value) => {
                    node._mode_value = value == true || value == "Populate";
                    populated_text_widget.inputEl.disabled = value == true || value == "Populate";
                },
                get: () => {
                    if (node._mode_value != undefined)
                        return node._mode_value;
                    else
                        return true;
                }
            });

            // 프리셋 목록 불러와서 위젯에 설정
            const loadPresetTitles = () => {
                fetchPresetTitles().then(titles => {
                    presetWidget.options.values = titles;
                    app.graph.setDirtyCanvas(true);
                });
            };

            // 프리셋 선택 위젯 추가
            const presetWidget = node.addWidget("combo", "Preset", "", (value) => {
                node.selectedPreset = value;
                console.log("Preset selected:", value); // 프리셋 선택 확인
                loadPresetTitles(); // 프리셋 목록 다시 로드
            }, { values: [] });

            loadPresetTitles();

            // 저장 버튼 추가
            const saveButton = node.addWidget("button", "Save", "", () => {
                const inputString = wildcard_text_widget.value;
                const defaultTitle = node.selectedPreset || "default_preset_name"; // 현재 선택된 프리셋 이름을 기본값으로 설정

                const title = prompt("Enter the name for the preset:", defaultTitle);
                if (title) {
                    console.log("Saving preset:", title, inputString); // 콘솔 로그 추가

                    const saveFile = async (title, content) => {
                        try {
                            const response = await fetch("/inspire/save_preset", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({ title, content }),
                            });
                            if (!response.ok) throw new Error("Failed to save preset");

                            console.log("Save successful"); // 콘솔 로그 추가

                            // 프리셋 목록 다시 로드
                            loadPresetTitles();
                        } catch (e) {
                            console.error("File save error: ", e);
                        }
                    };

                    saveFile(title, inputString);
                }
            });

            // Load 버튼 추가
            const loadButton = node.addWidget("button", "Load", "",() => {
				console.log("Loading preset:", node.selectedPreset); 
                if (node.selectedPreset) {
                    fetchPresetContent(node.selectedPreset).then(content => {
                        console.log("Fetched preset content:", content); // 콘솔 로그 추가
                        wildcard_text_widget.value = content;
                        // 위젯 갱신
                        node.widgets[wildcard_text_widget_index].value = content;
                        node.setDirtyCanvas(true); // 캔버스를 다시 그리도록 설정
                    }).catch(e => {
                        console.error("Load error:", e); // 에러 로그 추가
                    });
                } else {
                    console.log("No preset selected"); // 프리셋이 선택되지 않은 경우 로그
                }
            });

        }
        else if (node.comfyClass == "MakeBasicPipe //Inspire") {
            const pos_wildcard_text_widget = node.widgets.find((w) => w.name == 'positive_wildcard_text');
            const pos_populated_text_widget = node.widgets.find((w) => w.name == 'positive_populated_text');
            const neg_wildcard_text_widget = node.widgets.find((w) => w.name == 'negative_wildcard_text');
            const neg_populated_text_widget = node.widgets.find((w) => w.name == 'negative_populated_text');

            const mode_widget = node.widgets.find((w) => w.name == 'wildcard_mode');
            const direction_widget = node.widgets.find((w) => w.name == 'Add selection to');

            // lora selector, wildcard selector
            let combo_id = 5;

            Object.defineProperty(node.widgets[combo_id], "value", {
                set: (value) => {
                    const stackTrace = new Error().stack;
                    if (stackTrace.includes('inner_value_change')) {
                        if (value != "Select the LoRA to add to the text") {
                            let lora_name = value;
                            if (lora_name.endsWith('.safetensors')) {
                                lora_name = lora_name.slice(0, -12);
                            }

                            if (direction_widget.value) {
                                pos_wildcard_text_widget.value += `<lora:${lora_name}>`;
                            }
                            else {
                                neg_wildcard_text_widget.value += `<lora:${lora_name}>`;
                            }
                        }
                    }
                },
                get: () => { return "Select the LoRA to add to the text"; }
            });

            Object.defineProperty(node.widgets[combo_id + 1], "value", {
                set: (value) => {
                    const stackTrace = new Error().stack;
                    if (stackTrace.includes('inner_value_change')) {
                        if (value != "Select the Wildcard to add to the text") {
                            let w = null;
                            if (direction_widget.value) {
                                w = pos_wildcard_text_widget;
                            }
                            else {
                                w = neg_wildcard_text_widget;
                            }

                            if (w.value != '')
                                w.value += ', '

                            w.value += value;
                        }
                    }
                },
                get: () => { return "Select the Wildcard to add to the text"; }
            });

            Object.defineProperty(node.widgets[combo_id + 1].options, "values", {
                set: (x) => { },
                get: () => {
                    return get_wildcards_list();
                }
            });

            // Preventing validation errors from occurring in any situation.
            node.widgets[combo_id].serializeValue = () => { return "Select the LoRA to add to the text"; }
            node.widgets[combo_id + 1].serializeValue = () => { return "Select the Wildcard to add to the text"; }

            // wildcard populating
            pos_populated_text_widget.inputEl.disabled = true;
            neg_populated_text_widget.inputEl.disabled = true;

            // mode combo
            Object.defineProperty(mode_widget, "value", {
                set: (value) => {
                    pos_populated_text_widget.inputEl.disabled = node._mode_value;
                    neg_populated_text_widget.inputEl.disabled = node._mode_value;
                    node._mode_value = value;
                },
                get: () => {
                    if (node._mode_value != undefined)
                        return node._mode_value;
                    else
                        return true;
                }
            });
        }
        else if (node.comfyClass == "PromptBuilder //Inspire") {
            const preset_widget = node.widgets[node.widgets.findIndex(obj => obj.name === 'preset')];
            const category_widget = node.widgets[node.widgets.findIndex(obj => obj.name === 'category')];

            Object.defineProperty(preset_widget.options, "values", {
                set: (x) => { },
                get: () => {
                    get_prompt_builder_items(category_widget.value);
                    if (pb_cache[category_widget.value] == undefined) {
                        return ["#PRESET"];
                    }
                    return pb_cache[category_widget.value];
                }
            });

            Object.defineProperty(preset_widget, "value", {
                set: (x) => {
                    const stackTrace = new Error().stack;
                    if (stackTrace.includes('inner_value_change')) {
                        if (node.widgets[2].value) {
                            node.widgets[2].value += ', ';
                        }

                        const y = x.split(':');
                        if (y.length == 2)
                            node.widgets[2].value += y[1].trim();
                        else
                            node.widgets[2].value += x.trim();

                        if (node.widgets_values) {
                            node.widgets_values[2] = node.widgets[2].values;
                        }
                    };
                },
                get: () => { return '#PRESET'; }
            });

            preset_widget.serializeValue = (workflowNode, widgetIndex) => { return "#PRESET"; };
        }
        else if (node.comfyClass == "SeedExplorer //Inspire"
            || node.comfyClass == "RegionalSeedExplorerMask //Inspire"
            || node.comfyClass == "RegionalSeedExplorerColorMask //Inspire") {
            const prompt_widget = node.widgets[node.widgets.findIndex(obj => obj.name === 'seed_prompt')];
            const seed_widget = node.widgets[node.widgets.findIndex(obj => obj.name === 'additional_seed')];
            const strength_widget = node.widgets[node.widgets.findIndex(obj => obj.name === 'additional_strength')];

            let allow_init_seed = node.comfyClass == "SeedExplorer //Inspire";

            node.addWidget("button", "Add to prompt", null, () => {
                if (!prompt_widget.value?.trim() && allow_init_seed) {
                    prompt_widget.value = '' + seed_widget.value;
                }
                else {
                    if (prompt_widget.value?.trim())
                        prompt_widget.value += ', ';

                    prompt_widget.value += `${seed_widget.value}:${strength_widget.value.toFixed(2)}`;
                    seed_widget.value += 1;
                }
            });
        }
    }
});

const original_queuePrompt = api.queuePrompt;
async function queuePrompt_with_widget_idxs(number, { output, workflow }) {
    workflow.widget_idx_map = {};

    for (let i in app.graph._nodes_by_id) {
        let widgets = app.graph._nodes_by_id[i].widgets;
        if (widgets) {
            for (let j in widgets) {
                if (['seed', 'noise_seed', 'sampler_name', 'scheduler'].includes(widgets[j].name)
                    && widgets[j].type != 'converted-widget') {
                    if (workflow.widget_idx_map[i] == undefined) {
                        workflow.widget_idx_map[i] = {};
                    }

                    workflow.widget_idx_map[i][widgets[j].name] = parseInt(j);
                }
            }
        }
    }

    return await original_queuePrompt.call(api, number, { output, workflow });
}

api.queuePrompt = queuePrompt_with_widget_idxs;
