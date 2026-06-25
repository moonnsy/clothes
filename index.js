import { getContext } from '../../../extensions.js';
import { eventSource, event_types, generateRaw } from '../../../../script.js';

const extensionName = "Clothes";
const LOG_PREFIX = "[Clothes]";

let clothesState = {
    items: [], // { id, type, folder, name, description, imageBase64 }
    activeCharItemId: null, // Legacy global fallback
    activeUserItemId: null // Legacy global fallback
};

let currentMode = 'clothes'; // 'clothes' | 'location'
let activeProfileName = '';
let currentView = 'gallery'; // 'gallery' | 'edit'
let editingItemId = null;
let currentEntity = '';
let currentType = 'char'; // 'char' | 'user'
let currentFolder = 'All'; // 'All' | folderName
let currentSubCategory = 'all'; // 'all' | 'outfit' | 'hairstyle' | 'accessory' | 'makeup'
let editingItemTags = []; // string[]
let filterActiveOnly = false;
let itemToDeleteId = null;

// --- CHAT SPECIFIC STATE ---
function getActiveItems(mode = currentMode) {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    let entities = {};
    let isStContext = false;
    
    if (stContext && stContext.chatMetadata) {
        if (!stContext.chatMetadata[mode]) stContext.chatMetadata[mode] = {};
        if (!stContext.chatMetadata[mode].entities) stContext.chatMetadata[mode].entities = {};
        
        // Migrate old char/user layout to entities if needed (only for clothes)
        if (mode === 'clothes' && stContext.chatMetadata.clothes.char && !stContext.chatMetadata.clothes.entities[stContext.name2]) {
             stContext.chatMetadata.clothes.entities[stContext.name2 || 'Character'] = stContext.chatMetadata.clothes.char;
             delete stContext.chatMetadata.clothes.char;
        }
        if (mode === 'clothes' && stContext.chatMetadata.clothes.user && !stContext.chatMetadata.clothes.entities[stContext.name1]) {
             stContext.chatMetadata.clothes.entities[stContext.name1 || 'User'] = stContext.chatMetadata.clothes.user;
             delete stContext.chatMetadata.clothes.user;
        }
        
        entities = stContext.chatMetadata[mode].entities;
        isStContext = true;
    } else {
        // Global fallback
        if (!clothesState[`activeEntities_${mode}`]) clothesState[`activeEntities_${mode}`] = {};
        if (mode === 'clothes') {
            if (clothesState.activeCharItemId) {
                clothesState[`activeEntities_${mode}`]['Character'] = clothesState.activeCharItemId;
                clothesState.activeCharItemId = null;
            }
            if (clothesState.activeUserItemId) {
                clothesState[`activeEntities_${mode}`]['User'] = clothesState.activeUserItemId;
                clothesState.activeUserItemId = null;
            }
        }
        entities = clothesState[`activeEntities_${mode}`];
    }
    
    // Migrate string to object if mode === 'clothes'
    if (mode === 'clothes') {
        let changed = false;
        Object.keys(entities).forEach(name => {
            if (typeof entities[name] === 'string') {
                entities[name] = { outfit: entities[name] };
                changed = true;
            }
        });
        if (changed) {
            if (isStContext && typeof stContext.saveMetadataDebounced === 'function') {
                stContext.saveMetadataDebounced();
            } else if (!isStContext) {
                saveState();
            }
        }
    }
    
    return entities;
}

function setActiveItem(entityName, id, mode = currentMode, subCategory = 'outfit') {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    let entitiesObj = null;
    let isStContext = false;
    
    if (stContext && stContext.chatMetadata) {
        if (!stContext.chatMetadata[mode]) stContext.chatMetadata[mode] = {};
        if (!stContext.chatMetadata[mode].entities) stContext.chatMetadata[mode].entities = {};
        entitiesObj = stContext.chatMetadata[mode].entities;
        isStContext = true;
    } else {
        if (!clothesState[`activeEntities_${mode}`]) clothesState[`activeEntities_${mode}`] = {};
        entitiesObj = clothesState[`activeEntities_${mode}`];
    }
    
    if (mode === 'clothes') {
        if (!entitiesObj[entityName] || typeof entitiesObj[entityName] === 'string') {
            entitiesObj[entityName] = {};
        }
        if (id) {
            entitiesObj[entityName][subCategory] = id;
        } else {
            delete entitiesObj[entityName][subCategory];
            if (Object.keys(entitiesObj[entityName]).length === 0) {
                delete entitiesObj[entityName];
            }
        }
    } else {
        // locations
        if (id) {
            entitiesObj[entityName] = id;
        } else {
            delete entitiesObj[entityName];
        }
    }
    
    if (isStContext) {
        if (typeof stContext.saveMetadataDebounced === 'function') stContext.saveMetadataDebounced();
    } else {
        saveState();
    }
}

function getActiveTagFilter(entityName, mode = currentMode) {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    if (stContext && stContext.chatMetadata && stContext.chatMetadata[mode] && stContext.chatMetadata[mode].tagFilters) {
        return stContext.chatMetadata[mode].tagFilters[entityName] || null;
    }
    return clothesState[`activeTagFilters_${mode}`] ? clothesState[`activeTagFilters_${mode}`][entityName] || null : null;
}

function setActiveTagFilter(entityName, tag, mode = currentMode) {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    if (stContext && stContext.chatMetadata) {
        if (!stContext.chatMetadata[mode]) stContext.chatMetadata[mode] = {};
        if (!stContext.chatMetadata[mode].tagFilters) stContext.chatMetadata[mode].tagFilters = {};
        
        if (tag) {
            stContext.chatMetadata[mode].tagFilters[entityName] = tag;
        } else {
            delete stContext.chatMetadata[mode].tagFilters[entityName];
        }
        if (typeof stContext.saveMetadataDebounced === 'function') stContext.saveMetadataDebounced();
    } else {
        if (!clothesState[`activeTagFilters_${mode}`]) clothesState[`activeTagFilters_${mode}`] = {};
        if (tag) {
            clothesState[`activeTagFilters_${mode}`][entityName] = tag;
        } else {
            delete clothesState[`activeTagFilters_${mode}`][entityName];
        }
        saveState();
    }
}

// --- STSCRIPT INTEGRATION ---
function updateSTScriptVariables() {
    const stContext = getContext();
    const userName = stContext && stContext.name1 ? stContext.name1 : "User";
    const charName = stContext && stContext.name2 ? stContext.name2 : "Character";

    const trySet = (key, val) => {
        try {
            const stContext = getContext();
            if (stContext && stContext.variables && stContext.variables.global && typeof stContext.variables.global.set === 'function') {
                stContext.variables.global.set(key, val);
                return true;
            }
        } catch (e) {
            console.error(e);
        }
        return false;
    };

    const doRetrySet = (key, val) => {
        if (!trySet(key, val)) {
            const iv = setInterval(() => {
                if (trySet(key, val)) clearInterval(iv);
            }, 500);
            setTimeout(() => clearInterval(iv), 5000);
        }
    };

    ['clothes', 'location'].forEach(mode => {
        const activeItems = getActiveItems(mode);
        let userText = "";
        let charText = "";

        Object.keys(activeItems).forEach(entityName => {
            const itemObjOrId = activeItems[entityName];
            const itemIds = mode === 'clothes' ? Object.values(itemObjOrId || {}) : [itemObjOrId];

            itemIds.forEach(itemId => {
                const item = clothesState.items.find(i => i.id === itemId);
                if (item) {
                    const subCatNames = { outfit: 'Outfit', hairstyle: 'Hairstyle', accessory: 'Accessories', makeup: 'Makeup' };
                    const modeLabel = mode === 'location' ? 'Location' : (subCatNames[item.subCategory || 'outfit'] || 'Outfit');
                    let text = `${entityName}'s ${modeLabel}: ${item.name}`;
                    if (item.tags && item.tags.length > 0) text += " (" + item.tags.join(", ") + ")";
                    if (item.description) text += "\n" + item.description;

                    if (entityName === userName) {
                        if (userText) userText += "\n\n";
                        userText += text;
                    } else {
                        if (charText) charText += "\n\n";
                        charText += text;
                    }
                }
            });
        });

        doRetrySet(`${mode}_user`, userText);
        doRetrySet(`${mode}_char`, charText);

        // For locations: also set image variables when image injection mode is active
        if (mode === 'location') {
            const injectMode = localStorage.getItem('location_inject_mode') || 'text';
            let userImg = '';
            let charImg = '';

            if (injectMode === 'image') {
                Object.keys(activeItems).forEach(entityName => {
                    const itemId = activeItems[entityName];
                    const item = clothesState.items.find(i => i.id === itemId);
                    if (item) {
                        const img = (item.images && item.images.length > 0) ? item.images[0] : (item.imageBase64 || '');
                        if (entityName === userName) {
                            userImg = img;
                        } else {
                            charImg = img;
                        }
                    }
                });
            }

            doRetrySet('location_user_image', userImg);
            doRetrySet('location_char_image', charImg);
        }
    });
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function compressImage(dataUrl, maxWidth, maxHeight, quality = 0.8) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = width * ratio;
                height = height * ratio;
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            resolve(canvas.toDataURL('image/webp', quality));
        };
        img.src = dataUrl;
    });
}

// --- UI INJECTION ---
function attachToUI() {
    if ($('#extensionsMenu').length > 0 && $('#clothes-menu-item-container').length === 0) {
        $('#extensionsMenu').append(`
            <div id="clothes-menu-item-container" class="extension_container interactable" tabindex="0">
                <div id="clothes-wand-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0" style="align-items: center;">
                    <i class="fa-fw cl-custom-icon"></i>
                    <span>Clothes</span>
                </div>
            </div>
        `);
        $('#clothes-wand-item').on('click', () => {
            $('#cl-modal').css('display', 'block');
            currentView = 'gallery';
            
            renderTabs();
            loadProfiles();
            switchTab();
        });
    }
}

function buildModal() {
    $(`
    <div id="cl-modal">
        <div class="cl-flex-center">
            <div class="cl-flex-container">
                <div class="cl-header">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button class="cl-mode-btn active" data-mode="clothes"><i class="fa-solid fa-shirt"></i> Clothes</button>
                        <button class="cl-mode-btn" data-mode="location"><i class="fa-solid fa-map-location-dot"></i> Locations</button>
                    </div>
                    <div style="display:flex; align-items:center;">
                        <i class="fa-solid fa-eye-slash cl-settings-icon interactable" id="cl-btn-filter-active" title="Toggle Equipped Items Only" style="margin-right:15px; font-size:1.1em;"></i>
                        <i class="cl-settings-icon interactable" id="cl-btn-clear-all" title="Unequip All Outfits" style="margin-right:15px; display:inline-block; width:1.1em; height:1.1em; background-color:currentColor; -webkit-mask:url('https://img.icons8.ru/ios-filled/50/cancel-2.png') no-repeat center / contain; mask:url('https://img.icons8.ru/ios-filled/50/cancel-2.png') no-repeat center / contain;"></i>
                        <i class="fa-solid fa-gear cl-settings-icon interactable" id="cl-btn-settings" title="Settings"></i>
                        <i class="fa-solid fa-xmark cl-close" id="cl-btn-close"></i>
                    </div>
                </div>

                <div class="cl-tabs">
                    <!-- Tabs are dynamically rendered here -->
                </div>

                <!-- GALLERY VIEW -->
                <div class="cl-content cl-view active" id="cl-view-gallery">
                    <div class="cl-gallery-header" style="display:flex; gap:10px;">
                        <div style="flex:1; min-width:0;">
                            <select id="cl-folder-select" class="cl-select-field">
                                <option value="All">All Outfits</option>
                            </select>
                        </div>
                        <div id="cl-subcategory-wrapper" style="flex:1; min-width:0;">
                            <select id="cl-subcategory-select" class="cl-select-field">
                                <option value="all">All Categories</option>
                                <option value="outfit">Outfit</option>
                                <option value="hairstyle">Hairstyle</option>
                                <option value="accessory">Accessories</option>
                                <option value="makeup">Makeup</option>
                            </select>
                        </div>
                    </div>
                    <div class="cl-gallery-tags-filter" id="cl-gallery-tags-filter">
                        <!-- Filter tags will be rendered here -->
                    </div>
                    <div class="cl-gallery-grid" id="cl-gallery-grid">
                        <!-- Cards go here -->
                    </div>
                </div>

                <!-- EDIT VIEW -->
                <div class="cl-content cl-view" id="cl-view-edit">
                    <button class="cl-btn cl-btn-secondary" id="cl-btn-back-gallery" style="margin-top:0; margin-bottom:15px; width:auto; padding: 8px 15px;"><i class="fa-solid fa-arrow-left"></i> Back</button>

                    <div class="cl-multi-image-grid" id="cl-multi-image-grid">
                        <!-- slots rendered dynamically -->
                    </div>
                    <input type="file" id="cl-file-edit" accept="image/*" multiple style="display:none;">

                    <div id="cl-edit-subcategory-wrapper" style="margin-bottom:15px;">
                        <span class="cl-label" id="cl-edit-label-subcategory" style="margin-top:0;">Category</span>
                        <select id="cl-subcategory-edit" class="cl-select-field">
                            <option value="outfit">Outfit</option>
                            <option value="hairstyle">Hairstyle</option>
                            <option value="accessory">Accessories</option>
                            <option value="makeup">Makeup</option>
                        </select>
                    </div>

                    <span class="cl-label" id="cl-edit-label-name" style="margin-top:0;">Name</span>
                    <input type="text" id="cl-name-edit" class="cl-input-field" placeholder="E.g., Casual Dress">

                    <span class="cl-label">Tags (Press Enter or + to add)</span>
                    <div style="display:flex; gap: 8px; align-items: stretch;">
                        <input type="text" id="cl-tags-input-edit" class="cl-input-field" placeholder="E.g., casual, summer, office..." style="flex-grow: 1; margin: 0;">
                        <button class="cl-btn cl-btn-secondary" id="cl-btn-add-tag" style="margin: 0; width: 45px; padding: 0; display:flex; align-items:center; justify-content:center; flex-shrink: 0;"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    <div class="cl-tags-container" id="cl-tags-list-edit"></div>
                    <div class="cl-suggested-tags" id="cl-tags-suggested-edit"></div>

                    <span class="cl-label" id="cl-edit-label-desc">Outfit Description (Context)</span>
                    <textarea id="cl-desc-edit" class="cl-input-field" style="resize:vertical; min-height:80px;" placeholder="AI will describe the outfit here, or write manually..."></textarea>

                    <button class="cl-btn" id="cl-btn-describe-edit" title="Hold or Right-Click to add an OOC note"><i class="fa-solid fa-wand-magic-sparkles"></i> Describe with AI</button>
                    <button class="cl-btn cl-btn-secondary" id="cl-btn-save-edit" style="margin-top: 10px;"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
                </div>

                <!-- SETTINGS PANE -->
                <div class="cl-content cl-view" id="cl-view-settings">
                    <div style="margin-bottom: 15px;">
                        <span class="cl-label" style="margin-top:0;">Theme</span>
                        <select id="cl-setting-theme" class="cl-select-field">
                            <option value="blue">Blue (Default)</option>
                            <option value="grey">Grey</option>
                            <option value="rose">Rose</option>
                            <option value="emerald">Emerald</option>
                            <option value="auto">Tavern Auto</option>
                        </select>
                    </div>

                    <div style="display:flex; gap:15px; margin-bottom:15px;">
                        <div style="flex:1;">
                            <span class="cl-label" style="margin-top:0;">Clothes Prompt</span>
                            <select id="cl-setting-prompt" class="cl-select-field">
                                <option value="brief">Brief</option>
                                <option value="detailed">Detailed</option>
                            </select>
                        </div>
                        <div style="flex:1;">
                            <span class="cl-label" style="margin-top:0;">Locations Prompt</span>
                            <select id="cl-setting-loc-prompt" class="cl-select-field">
                                <option value="brief">Brief</option>
                                <option value="detailed">Detailed</option>
                            </select>
                        </div>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <span class="cl-label">Grid Columns (Mobile)</span>
                        <select id="cl-setting-grid" class="cl-select-field">
                            <option value="auto">Auto (Responsive)</option>
                            <option value="2">2 Columns</option>
                            <option value="3">3 Columns</option>
                        </select>
                    </div>

                    <div style="display:flex; gap:15px; margin-bottom:15px;">
                        <div style="flex:1;">
                            <span class="cl-label" style="margin-top:0;">Clothes Depth</span>
                            <input type="number" id="cl-setting-depth" class="cl-input-field" value="0" min="0" max="999">
                        </div>
                        <div style="flex:1;">
                            <span class="cl-label" style="margin-top:0;">Locations Depth</span>
                            <input type="number" id="cl-setting-loc-depth" class="cl-input-field" value="0" min="0" max="999">
                        </div>
                    </div>

                    <div style="display:flex; gap:15px; margin-bottom:15px;">
                        <div style="flex:1;">
                            <span class="cl-label" style="margin-top:0;">Clothes Max Tokens</span>
                            <input type="number" id="cl-setting-max-tokens" class="cl-input-field" value="4000" min="10" max="100000">
                        </div>
                        <div style="flex:1;">
                            <span class="cl-label" style="margin-top:0;">Locations Max Tokens</span>
                            <input type="number" id="cl-setting-loc-max-tokens" class="cl-input-field" value="4000" min="10" max="100000">
                        </div>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <span class="cl-label">Location Injection Mode</span>
                        <select id="cl-setting-loc-inject" class="cl-select-field">
                            <option value="text">Text Description</option>
                            <option value="image">Image Attachment (Multimodal)</option>
                        </select>
                    </div>

                    <label class="cl-checkbox-wrapper" style="margin-top: 15px;">
                        <input type="checkbox" id="cl-setting-quick-icon" class="cl-checkbox">
                        <div class="cl-checkbox-custom"></div>
                        <span style="color:#E5E7EB; font-size:0.9em;">Show quick access icon near chat bar</span>
                    </label>

                    <hr style="border:0; border-top:1px solid rgba(255,255,255,0.05); margin:15px 0;">

                    <span class="cl-label">API Connection Profile (Must support Vision!)</span>
                    <div style="display: flex; gap: 8px;">
                        <select id="cl-api-profile-select" class="cl-select-field" style="flex: 1;"></select>
                        <button id="cl-btn-sync-profiles" class="cl-btn cl-btn-secondary" style="margin-top: 0; width: auto; padding: 8px 12px;" title="Sync"><i class="fa-solid fa-arrows-rotate"></i></button>
                    </div>
                    <button id="cl-btn-test-profile" class="cl-btn cl-btn-secondary" style="margin-top: 10px;">Test Connection</button>
                    <div id="cl-api-status" class="cl-status-text"></div>
                    
                    <hr style="border:0; border-top:1px solid rgba(255,255,255,0.05); margin:20px 0 15px 0;">
                    <button class="cl-btn" id="cl-btn-save-settings"><i class="fa-solid fa-check"></i> Save Settings</button>
                </div>

            </div>
        </div>

        <!-- Custom OOC Modal -->
        <div id="cl-custom-prompt-modal" class="cl-modal-overlay" style="display:none;">
            <div class="cl-modal-box">
                <h3 style="margin-top:0; color:#E5E7EB; font-size:1.1em;">Describe with AI</h3>
                <p style="font-size:0.85em; color:#9CA3AF; margin-bottom:10px;">Add OOC instructions (optional):</p>
                <textarea id="cl-custom-ooc-input" class="cl-input-field" style="min-height:80px; resize:vertical;" placeholder="E.g., It's a cyberpunk style, focus on neon colors..."></textarea>
                <div style="display:flex; justify-content:center; gap:10px; margin-top:15px;">
                    <button class="cl-btn cl-btn-secondary" id="cl-btn-cancel-ooc" style="flex:1; margin:0; padding:10px;">Cancel</button>
                    <button class="cl-btn" id="cl-btn-generate-ooc" style="flex:1; margin:0; padding:10px;"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button>
                </div>
            </div>
        </div>

        <!-- Custom Confirm Delete Modal -->
        <div id="cl-custom-confirm-modal" class="cl-modal-overlay" style="display:none;">
            <div class="cl-modal-box" style="max-width:300px; text-align:center;">
                <h3 style="margin-top:0; color:#E5E7EB; font-size:1.1em;">Confirm Deletion</h3>
                <p style="font-size:0.85em; color:#9CA3AF; margin-bottom:20px;">Are you sure you want to delete this item?</p>
                <div style="display:flex; justify-content:center; gap:10px;">
                    <button class="cl-btn cl-btn-secondary" id="cl-btn-cancel-delete" style="flex:1; margin:0; padding:10px;">Cancel</button>
                    <button class="cl-btn cl-card-btn-del" id="cl-btn-confirm-delete" style="flex:1; margin:0; padding:10px; color:#fff;"><i class="fa-solid fa-trash"></i> Delete</button>
                </div>
            </div>
        </div>
    </div>
    `).appendTo('body');

    bindEvents();
    clInitCustomSelects();
}

function clInitCustomSelects() {
    $('.cl-select-field').each(function() {
        const select = $(this);
        if (select.data('custom-select-init')) return;
        select.data('custom-select-init', true);

        const wrapper = $('<div class="cl-custom-select-wrapper"></div>');
        const display = $('<div class="cl-custom-select-display"></div>');
        const list = $('<div class="cl-custom-select-list"></div>');
        
        select.after(wrapper);
        wrapper.append(select).append(display).append(list);

        function updateDisplay() {
            const selectedOpt = select.find('option:selected');
            display.text(selectedOpt.text() || '');
            list.find('.cl-custom-select-option').removeClass('selected');
            list.find(`.cl-custom-select-option[data-val="${selectedOpt.val()}"]`).addClass('selected');
        }

        function updateList() {
            list.empty();
            select.find('option').each(function() {
                const opt = $(this);
                const item = $(`<div class="cl-custom-select-option" data-val="${opt.val()}">${opt.text()}</div>`);
                item.on('click', function(e) {
                    e.stopPropagation();
                    select.val(opt.val()).trigger('change');
                    wrapper.removeClass('open');
                    list.hide();
                });
                list.append(item);
            });
            updateDisplay();
        }

        updateList();

        const observer = new MutationObserver(() => updateList());
        observer.observe(select[0], { childList: true });

        select.on('change', updateDisplay);

        display.on('click', function(e) {
            e.stopPropagation();
            const isOpen = wrapper.hasClass('open');
            $('.cl-custom-select-wrapper').removeClass('open').find('.cl-custom-select-list').hide();
            if (!isOpen) {
                wrapper.addClass('open');
                list.show();
            }
        });
    });

    $(document).off('click.clcustomselect').on('click.clcustomselect', function() {
        $('.cl-custom-select-wrapper').removeClass('open').find('.cl-custom-select-list').hide();
    });
}

function applyTheme(theme) {
    if (!theme) theme = 'blue';
    $('html').attr('data-cl-theme', theme);
}

function escapeHtml(unsafe) {
    return (unsafe || "").toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function renderTabs() {
    const stContext = getContext();
    const userName = stContext.name1 || 'User';
    
    let members = [];
    if (stContext.groupId) {
        const group = stContext.groups.find(g => g.id === stContext.groupId);
        if (group && group.members) {
            members = group.members.map(avatar => {
                const char = stContext.characters.find(c => c.avatar === avatar);
                return char ? char.name : null;
            }).filter(Boolean);
        }
    } else {
        members = [stContext.name2 || 'Character'];
    }

    const $tabs = $('.cl-tabs');
    $tabs.empty();
    
    // User tab always first
    $tabs.append(`<div class="cl-tab-btn" data-entity="${escapeHtml(userName)}" data-type="user">${escapeHtml(userName)}</div>`);
    
    // Character tabs
    members.forEach(m => {
        $tabs.append(`<div class="cl-tab-btn" data-entity="${escapeHtml(m)}" data-type="char">${escapeHtml(m)}</div>`);
    });

    // Make sure we have a valid selection
    let found = false;
    $('.cl-tab-btn').each(function() {
        if ($(this).data('entity') === currentEntity) found = true;
    });

    if (!found) {
        const fallback = members.length > 0 ? members[0] : userName;
        currentEntity = fallback;
        currentType = fallback === userName ? 'user' : 'char';
    }

    $('.cl-tab-btn').filter(function() { return $(this).data('entity') === currentEntity; }).addClass('active');

    $('.cl-tab-btn').off('click').on('click', function() {
        switchTab($(this).attr('data-entity'), $(this).attr('data-type'));
    });
}

function switchTab(entity, type) {
    if (entity && type) {
        currentEntity = entity;
        currentType = type;
    }
    
    $('.cl-tab-btn').removeClass('active');
    $('.cl-tab-btn').filter(function() { return $(this).data('entity') === currentEntity; }).addClass('active');
    
    currentFolder = currentEntity || 'Default';
    
    if (currentView === 'settings') {
        currentView = 'gallery';
    }
    showView('gallery');
    renderGallery();
}

function showView(viewName) {
    currentView = viewName;
    $('.cl-view').removeClass('active');
    $(`#cl-view-${viewName}`).addClass('active');
}

function bindEvents() {
    // Mode Switcher
    $(document).on('click', '.cl-mode-btn', function() {
        $('.cl-mode-btn').removeClass('active');
        $(this).addClass('active');
        currentMode = $(this).data('mode');
        
        // Update labels based on mode
        if (currentMode === 'location') {
            $('#cl-edit-label-name').text('Name');
            $('#cl-edit-label-desc').text('Location Description (Context)');
            $('#cl-folder-select option[value="All"]').text('All Locations');
            $('#cl-subcategory-wrapper').hide();
            $('#cl-edit-subcategory-wrapper').hide();
        } else {
            $('#cl-edit-label-name').text('Name');
            $('#cl-edit-label-desc').text('Outfit Description (Context)');
            $('#cl-folder-select option[value="All"]').text('All Outfits');
            $('#cl-subcategory-wrapper').show();
            $('#cl-edit-subcategory-wrapper').show();
        }
        
        switchTab(currentEntity, currentType); // Re-renders gallery for current tab but new mode
    });

    $('#cl-btn-filter-active').on('click', function() {
        filterActiveOnly = !filterActiveOnly;
        if (filterActiveOnly) {
            $(this).removeClass('fa-eye-slash').addClass('fa-eye').css('color', 'var(--cl-accent)');
        } else {
            $(this).removeClass('fa-eye').addClass('fa-eye-slash').css('color', '');
        }
        renderGallery();
    });

    $('#cl-btn-clear-all').on('click', async () => {
        const stContext = getContext();
        if (stContext && stContext.chatMetadata && stContext.chatMetadata[currentMode]) {
            stContext.chatMetadata[currentMode].entities = {};
            if (typeof stContext.saveMetadataDebounced === 'function') stContext.saveMetadataDebounced();
        } else {
            clothesState[`activeEntities_${currentMode}`] = {};
            saveState();
        }
        updateContext();
        updateSTScriptVariables();
        renderGallery();
        toastr.success(`All ${currentMode === 'location' ? 'locations' : 'outfits'} unequipped for this chat`);
    });

    $('#cl-btn-close').on('click', () => {
        $('#cl-modal').css('display', 'none');
        saveState();
        updateContext();
    });
    $('#cl-btn-settings').on('click', function() {
        $('.cl-tab-btn').removeClass('active'); // Settings is outside tabs
        showView('settings');
        loadProfiles();
    });

    $('#cl-setting-theme').on('change', function() {
        const t = $(this).val();
        localStorage.setItem('clothes_theme', t);
        applyTheme(t);
    });

    $('#cl-setting-prompt').on('change', function() {
        localStorage.setItem('clothes_prompt', $(this).val());
    });
    $('#cl-setting-loc-prompt').on('change', function() {
        localStorage.setItem('location_prompt', $(this).val());
    });

    $('#cl-setting-grid').on('change', function() {
        const val = $(this).val();
        localStorage.setItem('clothes_grid', val);
        renderGallery();
    });

    $('#cl-setting-depth').on('input change', function() {
        localStorage.setItem('clothes_depth', $(this).val());
        updateContext();
    });
    $('#cl-setting-loc-depth').on('input change', function() {
        localStorage.setItem('location_depth', $(this).val());
        updateContext();
    });

    $('#cl-setting-max-tokens').on('input change', function() {
        localStorage.setItem('clothes_max_tokens', $(this).val());
    });
    $('#cl-setting-loc-max-tokens').on('input change', function() {
        localStorage.setItem('location_max_tokens', $(this).val());
    });

    $('#cl-setting-loc-inject').on('change', function() {
        localStorage.setItem('location_inject_mode', $(this).val());
        updateContext();
    });

    $('#cl-folder-select').on('change', function() {
        currentFolder = $(this).val();
        setActiveTagFilter(currentEntity, null, currentMode);
        renderGallery();
    });

    $('#cl-subcategory-select').on('change', function() {
        currentSubCategory = $(this).val();
        setActiveTagFilter(currentEntity, null, currentMode);
        renderGallery();
    });

    $('#cl-btn-back-gallery').on('click', () => {
        showView('gallery');
        renderGallery();
    });

    $('#cl-btn-save-edit').on('click', () => {
        saveCurrentEdit();
        toastr.success("Outfit saved!");
        showView('gallery');
        renderGallery();
    });

    $('#cl-btn-save-settings').on('click', () => {
        toastr.success("Settings saved!");
    });

    $('#cl-tags-input-edit').on('keypress', function(e) {
        if (e.which === 13) { // Enter
            e.preventDefault();
            addTagFromInput();
        }
    });

    $('#cl-btn-add-tag').on('click', (e) => {
        e.preventDefault();
        addTagFromInput();
    });

    function addTagFromInput() {
        const val = $('#cl-tags-input-edit').val().trim();
        if (val) {
            const newTags = val.split(',').map(t => t.trim()).filter(t => t);
            newTags.forEach(t => {
                if (!editingItemTags.includes(t)) editingItemTags.push(t);
            });
            renderEditTags();
            $('#cl-tags-input-edit').val('');
        }
    }

    // Settings
    $('#cl-setting-quick-icon').on('change', function() {
        const isChecked = $(this).is(':checked');
        localStorage.setItem('clothes_quick_icon', isChecked ? 'true' : 'false');
        toggleQuickIcon(isChecked);
    });

    // Multi-image uploader logic
    let editImages = window._clEditImages || []; // up to 4 base64 strings
    let pendingSlotIndex = -1; // which slot triggered the file picker

    // Bridge: openEditView sets window._clEditImages, then triggers cl-render-slots
    $(document).on('cl-render-slots', () => {
        editImages = window._clEditImages || [];
        renderImageSlots();
    });
    // Also keep window._clEditImages in sync when editImages changes locally
    function syncEditImages() {
        window._clEditImages = editImages;
    }

    function renderImageSlots() {
        const $grid = $('#cl-multi-image-grid');
        $grid.empty();

        // Always render exactly 4 fixed slots
        for (let i = 0; i < 4; i++) {
            const src = editImages[i] || '';
            const hasImage = !!src;
            const $slot = $(`
                <div class="cl-img-slot ${hasImage ? 'has-image' : ''}" data-slot="${i}">
                    ${hasImage ? `<img src="${src}" class="cl-slot-preview">` : '<i class="fa-solid fa-plus"></i>'}
                    ${hasImage ? '<div class="cl-slot-clear" title="Remove"><i class="fa-solid fa-xmark"></i></div>' : ''}
                </div>
            `);
            $grid.append($slot);
        }
    }

    $(document).on('click', '.cl-img-slot', function(e) {
        if ($(e.target).closest('.cl-slot-clear').length) return;
        pendingSlotIndex = parseInt($(this).attr('data-slot'), 10);
        $('#cl-file-edit').trigger('click');
    });

    $(document).on('click', '.cl-slot-clear', function(e) {
        e.stopPropagation();
        const idx = parseInt($(this).closest('.cl-img-slot').attr('data-slot'), 10);
        editImages.splice(idx, 1);
        syncEditImages();
        renderImageSlots();
    });

    $('#cl-file-edit').on('change', async function(e) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        // If clicking on a filled slot, replace just that one image
        if (pendingSlotIndex >= 0 && pendingSlotIndex < editImages.length && files.length === 1) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                let result = event.target.result;
                try { result = await compressImage(result, 800, 800, 0.7); } catch(err) {}
                editImages[pendingSlotIndex] = result;
                pendingSlotIndex = -1;
                syncEditImages();
                renderImageSlots();
            };
            reader.readAsDataURL(files[0]);
        } else {
            // Batch fill: start from pendingSlotIndex (or first empty slot)
            let startIdx = (pendingSlotIndex >= 0 && pendingSlotIndex < 4) ? pendingSlotIndex : editImages.length;
            for (const file of files) {
                if (startIdx >= 4) break; // max 4
                const dataUrl = await new Promise(resolve => {
                    const r = new FileReader();
                    r.onload = (ev) => resolve(ev.target.result);
                    r.readAsDataURL(file);
                });
                let compressed = dataUrl;
                try { compressed = await compressImage(dataUrl, 800, 800, 0.7); } catch(err) {}
                if (startIdx < editImages.length) {
                    editImages[startIdx] = compressed;
                } else {
                    editImages.push(compressed);
                }
                startIdx++;
            }
            pendingSlotIndex = -1;
            syncEditImages();
            renderImageSlots();
        }
        $(this).val('');
    });

    function openOOCModal() {
        const existingOOC = $('#cl-btn-describe-edit').data('ooc') || '';
        $('#cl-custom-ooc-input').val(existingOOC);
        $('#cl-custom-prompt-modal').css('display', 'flex');
        $('#cl-custom-ooc-input').focus();
    }

    $('#cl-btn-cancel-ooc').on('click', () => {
        $('#cl-custom-prompt-modal').hide();
    });

    $('#cl-btn-generate-ooc').on('click', () => {
        const ooc = $('#cl-custom-ooc-input').val();
        $('#cl-btn-describe-edit').data('ooc', ooc);
        $('#cl-custom-prompt-modal').hide();
        describeImageEdit();
    });

    $('#cl-btn-cancel-delete').on('click', () => {
        $('#cl-custom-confirm-modal').hide();
        itemToDeleteId = null;
    });

    $('#cl-btn-confirm-delete').on('click', () => {
        if (!itemToDeleteId) return;
        const item = clothesState.items.find(i => i.id === itemToDeleteId);
        if (!item) {
            $('#cl-custom-confirm-modal').hide();
            return;
        }
        
        const activeItems = getActiveItems(currentMode);
        Object.keys(activeItems).forEach(entity => {
            if (currentMode === 'clothes') {
                const subCat = item.subCategory || 'outfit';
                if (activeItems[entity] && activeItems[entity][subCat] === item.id) {
                    setActiveItem(entity, null, currentMode, subCat);
                }
            } else {
                if (activeItems[entity] === item.id) setActiveItem(entity, null, currentMode);
            }
        });
        
        clothesState.items = clothesState.items.filter(i => i.id !== item.id);
        saveState();
        updateSTScriptVariables();
        updateContext();
        renderGallery();
        $('#cl-custom-confirm-modal').hide();
        itemToDeleteId = null;
    });

    let isDescribeLongPress = false;
    let describePressTimer = null;

    $('#cl-btn-describe-edit').on('mousedown touchstart', function(e) {
        if (e.which === 3) return; // Ignore right click
        isDescribeLongPress = false;
        describePressTimer = setTimeout(() => {
            isDescribeLongPress = true;
            describePressTimer = null;
            openOOCModal();
        }, 600);
    }).on('mouseup touchend mouseleave', function(e) {
        if (describePressTimer) {
            clearTimeout(describePressTimer);
            describePressTimer = null;
        }
    }).on('click', function(e) {
        if (isDescribeLongPress) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        describeImageEdit();
    }).on('contextmenu', function(e) {
        e.preventDefault();
        openOOCModal();
    });

    // API Profiles events
    $('#cl-api-profile-select').on('change', function() {
        activeProfileName = $(this).val();
        localStorage.setItem('clothes_active_profile_name', activeProfileName);
    });

    $('#cl-btn-sync-profiles').on('click', () => {
        loadProfiles();
        toastr.success('Profiles synchronized!');
    });

    $('#cl-btn-test-profile').on('click', async () => {
        const oldText = $('#cl-btn-test-profile').text();
        $('#cl-btn-test-profile').text('⏳').prop('disabled', true);
        $('#cl-api-status').text('Testing...');
        try {
            await testAPIProfile();
            $('#cl-api-status').text('Connection successful!').css('color', 'var(--cl-accent)');
        } catch (e) {
            $('#cl-api-status').text('Connection failed: ' + e.message).css('color', '#ef4444');
        } finally {
            $('#cl-btn-test-profile').text(oldText).prop('disabled', false);
        }
    });
}

// --- GALLERY LOGIC ---
function renderGallery() {
    const $grid = $('#cl-gallery-grid');
    $grid.empty();

    const tabItems = clothesState.items.filter(item => item.type === currentType && (item.category || 'clothes') === currentMode);
    
    // Manage Folders
    const folders = new Set();
    tabItems.forEach(item => { if (item.folder) folders.add(item.folder); });
    folders.add(currentEntity || 'Default');
    
    const $folderSelect = $('#cl-folder-select');
    $folderSelect.empty();
    $folderSelect.append(`<option value="All">All ${currentMode === 'location' ? 'Locations' : 'Outfits'}</option>`);
    Array.from(folders).sort().forEach(f => {
        $folderSelect.append(`<option value="${f}">${f}</option>`);
    });
    
    if (currentFolder !== 'All' && !folders.has(currentFolder)) {
        $folderSelect.append(`<option value="${currentFolder}">${currentFolder}</option>`);
    }
    $folderSelect.val(currentFolder);

    // Grid Layout
    const gridSetting = localStorage.getItem('clothes_grid') || 'auto';
    $grid.removeClass('cl-grid-col-auto cl-grid-col-2 cl-grid-col-3');
    $grid.addClass(`cl-grid-col-${gridSetting}`);

    // Filter Items by Folder
    const folderItems = currentFolder === 'All' 
        ? tabItems 
        : tabItems.filter(item => item.folder === currentFolder);

    // Filter by SubCategory (if clothes mode)
    const subCatItems = currentMode === 'clothes' && currentSubCategory !== 'all'
        ? folderItems.filter(item => (item.subCategory || 'outfit') === currentSubCategory)
        : folderItems;

    // Tags filtering UI
    const tagsSet = new Set();
    subCatItems.forEach(item => {
        if (item.tags && Array.isArray(item.tags)) {
            item.tags.forEach(t => tagsSet.add(t));
        }
    });

    const $tagsFilterContainer = $('#cl-gallery-tags-filter');
    $tagsFilterContainer.empty();
    
    let currentTagFilter = getActiveTagFilter(currentEntity, currentMode);
    
    if (currentTagFilter && !tagsSet.has(currentTagFilter)) {
        setActiveTagFilter(currentEntity, null, currentMode);
        currentTagFilter = null;
    }
    
    if (tagsSet.size > 0) {
        $tagsFilterContainer.show();
        $tagsFilterContainer.append(`<div class="cl-tag-chip ${!currentTagFilter ? 'active' : ''}" data-tag="">All</div>`);
        
        Array.from(tagsSet).sort().forEach(tag => {
            $tagsFilterContainer.append(`<div class="cl-tag-chip ${currentTagFilter === tag ? 'active' : ''}" data-tag="${tag}">${tag}</div>`);
        });

        // Tag click handler
        $tagsFilterContainer.find('.cl-tag-chip').on('click', function() {
            const t = $(this).attr('data-tag');
            setActiveTagFilter(currentEntity, t ? t : null, currentMode);
            renderGallery();
        });
    } else {
        $tagsFilterContainer.hide();
        setActiveTagFilter(currentEntity, null, currentMode);
        currentTagFilter = null;
    }

    // Filter Items by Tag
    const finalItems = currentTagFilter 
        ? subCatItems.filter(item => item.tags && item.tags.includes(currentTagFilter))
        : subCatItems;

    // Add New Card (only if not filtering active)
    if (!filterActiveOnly) {
        $grid.append(`
            <div class="cl-card cl-add-card" id="cl-grid-add">
                <i class="fa-solid fa-plus"></i>
                <span>Add New</span>
            </div>
        `);
        $('#cl-grid-add').on('click', () => openEditView(null));
    }

    let displayItems = finalItems;

    if (filterActiveOnly) {
        const activeItems = getActiveItems(currentMode);
        displayItems = tabItems.filter(item => {
            if (currentMode === 'clothes') {
                const subCat = item.subCategory || 'outfit';
                return activeItems[currentEntity] && activeItems[currentEntity][subCat] === item.id;
            } else {
                return activeItems[currentEntity] === item.id;
            }
        });
        
        $tagsFilterContainer.hide();
        $('#cl-folder-select').parent().hide();
        $('#cl-subcategory-wrapper').hide();
    } else {
        $('#cl-folder-select').parent().show();
        if (currentMode === 'clothes') $('#cl-subcategory-wrapper').show();
    }

    displayItems.forEach(item => {
        const activeItems = getActiveItems(currentMode);
        let isActive = false;
        if (currentMode === 'clothes') {
            const subCat = item.subCategory || 'outfit';
            isActive = activeItems[currentEntity] && activeItems[currentEntity][subCat] === item.id;
        } else {
            isActive = activeItems[currentEntity] === item.id;
        }
        
        const images = item.images && item.images.length > 0 ? item.images : (item.imageBase64 ? [item.imageBase64] : []);
        const imgCount = images.length;
        const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        
        let cardImgHtml = '';
        if (imgCount <= 1) {
            cardImgHtml = `<img class="cl-card-img" src="${images[0] || placeholder}">`;
        } else {
            cardImgHtml = `<div class="cl-card-img-collage cl-collage-${imgCount}">`;
            images.forEach(src => { cardImgHtml += `<img class="cl-card-img-cell" src="${src}">`; });
            cardImgHtml += '</div>';
        }
        
        const subCatNames = { outfit: 'Outfit', hairstyle: 'Hairstyle', accessory: 'Accessory', makeup: 'Makeup' };
        const fallbackName = item.category === 'location' ? 'Location' : (subCatNames[item.subCategory || 'outfit'] || 'Outfit');
        
        const $card = $(`
            <div class="cl-card ${isActive ? 'active-item' : ''}" data-id="${item.id}">
                ${cardImgHtml}
                <div class="cl-card-info">
                    <div class="cl-card-title" title="${item.name}">${item.name || fallbackName}</div>
                </div>
                <div class="cl-card-actions">
                    <button class="cl-card-btn cl-btn-edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="cl-card-btn cl-card-btn-del cl-btn-del"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `);

        // Click to select
        $card.on('click', (e) => {
            if ($(e.target).closest('.cl-card-actions').length) return; // Ignore if clicking buttons
            const activeItems = getActiveItems(currentMode);
            if (currentMode === 'clothes') {
                const subCat = item.subCategory || 'outfit';
                const currentlyActive = activeItems[currentEntity] && activeItems[currentEntity][subCat] === item.id;
                setActiveItem(currentEntity, currentlyActive ? null : item.id, currentMode, subCat);
            } else {
                setActiveItem(currentEntity, activeItems[currentEntity] === item.id ? null : item.id, currentMode);
            }
            updateContext();
            updateSTScriptVariables();
            
            // Update visually without rebuilding the DOM to prevent scroll jumps
            $('#cl-gallery-grid .cl-card').removeClass('active-item');
            const newActiveItems = getActiveItems(currentMode)[currentEntity];
            if (currentMode === 'clothes' && newActiveItems) {
                Object.values(newActiveItems).forEach(id => {
                    $(`#cl-gallery-grid .cl-card[data-id="${id}"]`).addClass('active-item');
                });
            } else if (newActiveItems) {
                $(`#cl-gallery-grid .cl-card[data-id="${newActiveItems}"]`).addClass('active-item');
            }
        });

        // Edit
        $card.find('.cl-btn-edit').on('click', (e) => {
            e.stopPropagation();
            openEditView(item.id);
        });

        // Delete
        $card.find('.cl-btn-del').on('click', (e) => {
            e.stopPropagation();
            itemToDeleteId = item.id;
            $('#cl-custom-confirm-modal').css('display', 'flex');
        });

        $grid.append($card);
    });
}

// --- EDIT LOGIC ---
function openEditView(itemId) {
    editingItemId = itemId;
    editingItemTags = [];
    const stContext = getContext();
    $('#cl-btn-describe-edit').removeData('ooc');
    
    // Access editImages from the closure via the binding scope
    const getEditImages = () => { try { return window._clEditImages; } catch(e) { return []; } };
    
    if (itemId) {
        const item = clothesState.items.find(i => i.id === itemId);
        if (item) {
            $('#cl-name-edit').val(item.name || '');
            $('#cl-desc-edit').val(item.description || '');
            $('#cl-subcategory-edit').val(item.subCategory || 'outfit').trigger('change');
            if (item.tags && Array.isArray(item.tags)) {
                editingItemTags = [...item.tags];
            }
            // Multi-image: populate editImages
            window._clEditImages = item.images && item.images.length > 0 
                ? [...item.images] 
                : (item.imageBase64 ? [item.imageBase64] : []);
        }
    } else {
        // New item
        $('#cl-name-edit').val('');
        $('#cl-desc-edit').val('');
        window._clEditImages = [];
    }
    
    $('#cl-tags-input-edit').val('');
    renderEditTags();
    showView('edit');
    // Render image slots after view is shown
    if (typeof renderImageSlots === 'undefined') {
        // renderImageSlots is inside bindEvents closure — we bridge via a custom event
        $(document).trigger('cl-render-slots');
    }
}

function renderEditTags() {
    const $list = $('#cl-tags-list-edit');
    $list.empty();
    editingItemTags.forEach((tag, idx) => {
        const $chip = $(`<div class="cl-tag-chip">${tag} <i class="fa-solid fa-xmark cl-tag-remove"></i></div>`);
        $chip.find('.cl-tag-remove').on('click', () => {
            editingItemTags.splice(idx, 1);
            renderEditTags();
        });
        $list.append($chip);
    });

    const suggested = new Set();
    clothesState.items.filter(i => i.type === currentType).forEach(i => {
        if (i.tags) i.tags.forEach(t => suggested.add(t));
    });
    editingItemTags.forEach(t => suggested.delete(t));

    const $suggList = $('#cl-tags-suggested-edit');
    $suggList.empty();
    Array.from(suggested).sort().slice(0, 15).forEach(tag => {
        const $chip = $(`<div class="cl-suggested-tag">+ ${tag}</div>`);
        $chip.on('click', () => {
            if (!editingItemTags.includes(tag)) {
                editingItemTags.push(tag);
                renderEditTags();
            }
        });
        $suggList.append($chip);
    });
}

function saveCurrentEdit() {
    if (currentView !== 'edit') return;
    
    const name = $('#cl-name-edit').val().trim();
    const desc = $('#cl-desc-edit').val().trim();
    const imgs = (window._clEditImages || []).filter(Boolean);

    if (!name && !desc && imgs.length === 0) {
        // Empty, don't save new
        if (!editingItemId) return;
    }

    const subCategory = $('#cl-subcategory-edit').val();

    let defaultName = '';
    if (currentMode === 'location') {
        const count = clothesState.items.filter(i => i.type === currentType && i.category === 'location').length;
        defaultName = `Location ${editingItemId ? Math.max(1, count) : count + 1}`;
    } else {
        const count = clothesState.items.filter(i => i.type === currentType && i.category === 'clothes' && (i.subCategory || 'outfit') === subCategory).length;
        const subCatNames = { outfit: 'Outfit', hairstyle: 'Hairstyle', accessory: 'Accessory', makeup: 'Makeup' };
        defaultName = `${subCatNames[subCategory] || 'Outfit'} ${editingItemId ? Math.max(1, count) : count + 1}`;
    }

    if (editingItemId) {
        const item = clothesState.items.find(i => i.id === editingItemId);
        if (item) {
            item.name = name || defaultName;
            item.description = desc;
            item.images = imgs;
            item.imageBase64 = imgs[0] || '';
            item.subCategory = subCategory;
            item.tags = [...editingItemTags];
        }
    } else {
        const stContext = getContext();
        let folderName = currentFolder;
        if (currentFolder === 'All') {
            folderName = currentEntity || 'Default';
        }

        const newItem = {
            id: generateId(),
            category: currentMode,
            type: currentType,
            folder: folderName,
            subCategory: subCategory,
            name: name || defaultName,
            description: desc,
            images: imgs,
            imageBase64: imgs[0] || '',
            tags: [...editingItemTags]
        };
        clothesState.items.push(newItem);
        editingItemId = newItem.id;
        
        const activeItems = getActiveItems(currentMode);
        if (currentMode === 'clothes') {
            if (!activeItems[currentEntity] || !activeItems[currentEntity][subCategory]) {
                setActiveItem(currentEntity, newItem.id, currentMode, subCategory);
            }
        } else {
            if (!activeItems[currentEntity]) {
                setActiveItem(currentEntity, newItem.id, currentMode);
            }
        }
    }
    
    saveState();
    updateSTScriptVariables();
    updateContext();
}

async function describeImageEdit() {
    const allImages = (window._clEditImages || []).filter(Boolean);
    if (allImages.length === 0) {
        toastr.warning("Please attach at least one image first.");
        return;
    }

    const $btn = $('#cl-btn-describe-edit');
    const oldText = $btn.html();
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Describing...').prop('disabled', true);

    try {
        const promptType = localStorage.getItem(currentMode === 'location' ? 'location_prompt' : 'clothes_prompt') || 'brief';
        const subCat = $('#cl-subcategory-edit').val() || 'outfit';
        let prompt = "";
        
        const strictNegative = "\n\nCRITICAL RESTRICTION: DO NOT under ANY circumstances describe the person's physical features. DO NOT describe hair color, eye color, skin tone, moles, freckles, body shape, or age. Focus ONLY on the requested items.";
        
        if (currentMode === 'location') {
            prompt = promptType === 'detailed' 
                ? "Describe this location directly as if writing a scene description for a novel. Detail the architecture, geography, weather, lighting, mood, time of day, and any significant objects or elements. Do not describe any characters—focus strictly and exclusively on the surroundings and atmosphere. Write in a single cohesive paragraph. IMPORTANT: Begin your description directly with what the place is (e.g. 'A sprawling medieval courtyard...' or 'The dimly lit alleyway...'). NEVER start with 'This image shows', 'The image depicts', or any similar meta-commentary about an image."
                : "Describe this location directly and concisely as if writing a scene description. Focus on architecture, nature, time of day, atmosphere, and key objects. Keep it under 5 sentences. Do not describe any characters. IMPORTANT: Begin directly with what the place is (e.g. 'A cozy café...'). NEVER start with 'This image', 'The image', or any meta-commentary about an image.";
            prompt += strictNegative;
        } else {
            if (subCat === 'outfit') {
                prompt = promptType === 'detailed'
                    ? "Please provide a highly detailed, comprehensive breakdown of the clothing and outfit worn by the main person in this image. Describe every visible layer, including the style, cut, color, material, pattern, and any unique details. Include all clothing accessories. Do not describe the person's physical features or background—focus strictly and exclusively on the garments. Provide your description in a single cohesive paragraph."
                    : "Please concisely describe the clothing and outfit worn by the main person in this image. Focus on style, colors, materials, and distinct clothing layers. Keep it under 5 sentences. Do not describe the person's physical features or background, ONLY the outfit.";
                prompt += strictNegative;
            } else if (subCat === 'hairstyle') {
                // Always brief, 2-3 sentences
                prompt = "Concisely describe the hairstyle: length, texture, styling, and any hair accessories. Keep it to 2-3 sentences. Do not describe the person's face, clothing, or background—ONLY the hair.";
                prompt += strictNegative;
            } else if (subCat === 'accessory') {
                // Always brief, 2-3 sentences
                prompt = "Concisely describe the accessories: jewelry, headwear, eyewear, bags, belts, gloves, or scarves. Note materials and colors. Keep it to 2-3 sentences. Do not describe clothing or the person—ONLY the accessories.";
                prompt += strictNegative;
            } else if (subCat === 'makeup') {
                // Always brief, 2-3 sentences
                prompt = "Concisely describe the makeup: eye makeup, lip color, and cosmetic styling. Keep it to 2-3 sentences. Do not describe natural features or clothing—ONLY the makeup.";
                prompt += strictNegative;
            }
        }

        // Add multi-image context note
        if (allImages.length > 1) {
            prompt += `\n\nNOTE: ${allImages.length} images are attached. Consider ALL of them together as parts of the same ${currentMode === 'location' ? 'scene/location' : 'look/outfit'}. Combine the details from all images into a single unified description.`;
        }

        let ooc = $('#cl-btn-describe-edit').data('ooc');
        if (ooc && ooc.trim()) {
            prompt += `\n\n[User's OOC Instructions: ${ooc.trim()}]`;
        }
        
        
        let resultText = "";

        const stContext = getContext();
        if (!activeProfileName) {
            resultText = await generateRaw({ prompt: prompt, systemPrompt: '', imageList: allImages });
            if (!resultText) throw new Error("API returned empty response.");
        } else {
            const profiles = stContext?.extensionSettings?.connectionManager?.profiles || [];
            const profile = profiles.find(p => p.name === activeProfileName);
            if (!profile) throw new Error(`Profile '${activeProfileName}' not found.`);

            const cc_source = profile.api || 'openai';
            const contentParts = [{ type: 'text', text: prompt }];
            allImages.forEach(imgB64 => {
                contentParts.push({ type: 'image_url', image_url: { url: imgB64 } });
            });
            const messages = [{
                role: 'user', 
                content: contentParts
            }];

            const maxTokensRaw = localStorage.getItem(currentMode === 'location' ? 'location_max_tokens' : 'clothes_max_tokens') || '4000';
            const maxTokens = parseInt(maxTokensRaw, 10);
            let generate_data = {
                'messages': messages,
                'model': profile.model,
                'temperature': 0.7,
                'max_tokens': maxTokens,
                'stream': false,
                'chat_completion_source': cc_source,
            };
            
            const profileApiValue = profile['api-url'];
            const ccSettings = stContext.chatCompletionSettings || {};
            
            if (cc_source === 'custom' && profileApiValue) {
                generate_data['custom_url'] = profileApiValue.trim().replace(/\/+$/, '');
            } else if (cc_source === 'vertexai' && profileApiValue) {
                generate_data['vertexai_region'] = profileApiValue;
                if (ccSettings.vertexai_auth_mode) generate_data['vertexai_auth_mode'] = ccSettings.vertexai_auth_mode;
                if (ccSettings.vertexai_express_project_id) generate_data['vertexai_express_project_id'] = ccSettings.vertexai_express_project_id;
            } else if (cc_source === 'zai' && profileApiValue) {
                generate_data['zai_endpoint'] = profileApiValue;
            }

            const headers = (typeof stContext.getRequestHeaders === 'function') ? stContext.getRequestHeaders() : {'Content-Type': 'application/json'};
            const res = await fetch('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(generate_data)
            });
            
            if (!res.ok) {
                const err = await res.json().catch(() => ({error: {message: "Unknown API error"}}));
                throw new Error(err.error?.message || 'Check console');
            }

            const json = await res.json();
            
            if (json.error) {
                throw new Error(json.error.message || JSON.stringify(json.error));
            }

            resultText = json.choices?.[0]?.message?.content || json.reply || '';
            
            if (!resultText) {
                console.error("Clothes Ext API Response:", json);
                throw new Error("API returned an empty response. Check console for full payload. (Could be safety filter or unsupported vision).");
            }
        }

        $('#cl-desc-edit').val(resultText.trim());
        saveCurrentEdit();
        toastr.success("Outfit described successfully!");

    } catch (e) {
        console.error(LOG_PREFIX, e);
        toastr.error("Failed to describe image: " + e.message);
    } finally {
        $btn.html(oldText).prop('disabled', false);
    }
}

// --- API PROFILE LOGIC ---
function loadProfiles() {
    const stContext = getContext();
    const profiles = stContext?.extensionSettings?.connectionManager?.profiles || [];
    
    activeProfileName = localStorage.getItem('clothes_active_profile_name') || '';
    
    const $sel = $('#cl-api-profile-select');
    $sel.empty();
    
    $sel.append($('<option>', { value: '', text: 'Tavern Main API' }));
    
    profiles.forEach(p => {
        $sel.append($('<option>', { value: p.name, text: p.name }));
    });
    
    if (activeProfileName && profiles.find(p => p.name === activeProfileName)) {
        $sel.val(activeProfileName);
    } else if (!activeProfileName) {
        $sel.val('');
    } else {
        activeProfileName = '';
        $sel.val('');
    }
}

async function testAPIProfile() {
    const stContext = getContext();
    if (!activeProfileName) {
        const result = await generateRaw({ prompt: 'respond with "ok"', systemPrompt: '' });
        if (!result) throw new Error("Main API failed to respond.");
        return;
    }
    
    const profiles = stContext?.extensionSettings?.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.name === activeProfileName);
    if (!profile) throw new Error("Profile not found.");

    const cc_source = profile.api || 'openai';
    let generate_data = {
        'messages': [{ role: 'user', content: 'respond with "ok"' }],
        'model': profile.model,
        'temperature': 0.3,
        'stream': false,
        'chat_completion_source': cc_source,
    };
    
    const profileApiValue = profile['api-url'];
    const ccSettings = stContext.chatCompletionSettings || {};
    
    if (cc_source === 'custom' && profileApiValue) {
        generate_data['custom_url'] = profileApiValue.trim().replace(/\/+$/, '');
        if (ccSettings.custom_prompt_post_processing) generate_data['custom_prompt_post_processing'] = ccSettings.custom_prompt_post_processing;
        if (ccSettings.custom_include_body) generate_data['custom_include_body'] = ccSettings.custom_include_body;
        if (ccSettings.custom_exclude_body) generate_data['custom_exclude_body'] = ccSettings.custom_exclude_body;
        if (ccSettings.custom_include_headers) generate_data['custom_include_headers'] = ccSettings.custom_include_headers;
    } else if (cc_source === 'vertexai' && profileApiValue) {
        generate_data['vertexai_region'] = profileApiValue;
        if (ccSettings.vertexai_auth_mode) generate_data['vertexai_auth_mode'] = ccSettings.vertexai_auth_mode;
        if (ccSettings.vertexai_express_project_id) generate_data['vertexai_express_project_id'] = ccSettings.vertexai_express_project_id;
    } else if (cc_source === 'zai' && profileApiValue) {
        generate_data['zai_endpoint'] = profileApiValue;
    }

    const headers = (typeof stContext.getRequestHeaders === 'function') ? stContext.getRequestHeaders() : {'Content-Type': 'application/json'};
    const res = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(generate_data)
    });
    
    if (!res.ok) {
        const err = await res.json().catch(() => ({error: {message: "Unknown error"}}));
        throw new Error(err.error?.message || 'Check console');
    }
}

// --- STATE AND CONTEXT ---
function loadState() {
    try {
        const stContext = getContext();
        let loaded = false;
        
        // Try to load from server sync first
        if (stContext && stContext.extensionSettings && stContext.extensionSettings.clothes_v2) {
            const parsed = stContext.extensionSettings.clothes_v2;
            if (Array.isArray(parsed.items)) clothesState.items = parsed.items;
            if (parsed.activeCharItemId) clothesState.activeCharItemId = parsed.activeCharItemId;
            if (parsed.activeUserItemId) clothesState.activeUserItemId = parsed.activeUserItemId;
            loaded = true;
        }

        if (!loaded) {
            // Fallback to localStorage
            const saved = localStorage.getItem('clothes_state_v2');
            if (saved) {
                const lp = JSON.parse(saved);
                if (Array.isArray(lp.items)) clothesState.items = lp.items;
                if (lp.activeCharItemId) clothesState.activeCharItemId = lp.activeCharItemId;
                if (lp.activeUserItemId) clothesState.activeUserItemId = lp.activeUserItemId;
                saveState(); // push to server
            } else {
                // Migrate from old state if exists
                const oldSaved = localStorage.getItem('clothes_state');
                if (oldSaved) {
                    const old = JSON.parse(oldSaved);
                    if (old.char && (old.char.name || old.char.description || old.char.imageBase64)) {
                        const id = generateId();
                        clothesState.items.push({ id, type: 'char', folder: 'Default', ...old.char });
                        clothesState.activeCharItemId = id;
                    }
                    if (old.user && (old.user.name || old.user.description || old.user.imageBase64)) {
                        const id = generateId();
                        clothesState.items.push({ id, type: 'user', folder: 'Default', ...old.user });
                        clothesState.activeUserItemId = id;
                    }
                    localStorage.removeItem('clothes_state'); // Clear old
                    saveState();
                }
            }
        }
    } catch(e) {
        console.error("Clothes loadState error:", e);
    }

    const theme = localStorage.getItem('clothes_theme') || 'blue';
    $('#cl-setting-theme').val(theme).trigger('change');
    
    const promptSetting = localStorage.getItem('clothes_prompt') || 'brief';
    $('#cl-setting-prompt').val(promptSetting).trigger('change');
    
    const locPrompt = localStorage.getItem('location_prompt') || 'brief';
    $('#cl-setting-loc-prompt').val(locPrompt).trigger('change');
    
    const grid = localStorage.getItem('clothes_grid') || 'auto';
    $('#cl-setting-grid').val(grid).trigger('change');
    
    const depth = localStorage.getItem('clothes_depth') || '0';
    $('#cl-setting-depth').val(depth);
    
    const locDepth = localStorage.getItem('location_depth') || '0';
    $('#cl-setting-loc-depth').val(locDepth);
    
    const maxTokens = localStorage.getItem('clothes_max_tokens') || '4000';
    $('#cl-setting-max-tokens').val(maxTokens);
    
    const locMaxTokens = localStorage.getItem('location_max_tokens') || '4000';
    $('#cl-setting-loc-max-tokens').val(locMaxTokens);
    
    const locInject = localStorage.getItem('location_inject_mode') || 'text';
    $('#cl-setting-loc-inject').val(locInject).trigger('change');
    
    const showQuick = localStorage.getItem('clothes_quick_icon') === 'true';
    $('#cl-setting-quick-icon').prop('checked', showQuick);
    toggleQuickIcon(showQuick);
    
    // One-time migration: imageBase64 -> images[] + compression
    setTimeout(async () => {
        let changed = false;
        for (let item of clothesState.items) {
            // Migrate single imageBase64 to images array
            if (!item.images) {
                item.images = item.imageBase64 ? [item.imageBase64] : [];
                changed = true;
            }
            // Compress any large images in the array
            for (let idx = 0; idx < item.images.length; idx++) {
                if (item.images[idx] && item.images[idx].length > 300000) {
                    try {
                        item.images[idx] = await compressImage(item.images[idx], 800, 800, 0.7);
                        changed = true;
                    } catch(e) {}
                }
            }
            // Keep imageBase64 in sync as first image for backward compat
            item.imageBase64 = item.images[0] || '';
        }
        if (changed) {
            saveState();
            console.log("Clothes extension migrated/compressed images.");
        }
    }, 2000);
}

function saveState() {
    const stContext = getContext();
    if (stContext && stContext.extensionSettings) {
        stContext.extensionSettings.clothes_v2 = clothesState;
        if (typeof stContext.saveSettingsDebounced === 'function') {
            stContext.saveSettingsDebounced();
        }
    }
    // Also save to localStorage as a fast local fallback
    localStorage.setItem('clothes_state_v2', JSON.stringify(clothesState));
}

function toggleQuickIcon(show) {
    if (show) {
        if ($('#cl-quick-icon').length === 0) {
            const injectIcon = () => {
                const $btn = $('#extensionsMenuButton');
                if ($btn.length) {
                    // We match the exact classes of the wand button so it inherits hover states and alignment naturally
                    $btn.after(`
                        <div id="cl-quick-icon" title="Clothes" class="fa-solid interactable cl-custom-icon" style="cursor:pointer; order: 99;" tabindex="0"></div>
                    `);
                    $('#cl-quick-icon').on('click', () => {
                        $('#clothes-wand-item').trigger('click');
                    });
                } else {
                    setTimeout(injectIcon, 250);
                }
            };
            injectIcon();
        }
    } else {
        $('#cl-quick-icon').remove();
    }
}

function updateContext() {
    const stContext = getContext();
    if (!stContext.extensionPrompts) stContext.extensionPrompts = {};

    // Do Clothes
    let clothesContextStr = "";
    const activeClothes = getActiveItems('clothes');
    Object.keys(activeClothes).forEach(entityName => {
        const itemIds = Object.values(activeClothes[entityName] || {});
        itemIds.forEach(itemId => {
            const item = clothesState.items.find(i => i.id === itemId);
            if (item && item.description) {
                const subCatNames = { outfit: 'Outfit', hairstyle: 'Hairstyle', accessory: 'Accessories', makeup: 'Makeup' };
                const modeLabel = subCatNames[item.subCategory || 'outfit'] || 'Outfit';
                let namePart = item.name ? ` (${item.name})` : '';
                clothesContextStr += `${entityName}'s ${modeLabel}${namePart}:\n${item.description}\n\n`;
            }
        });
    });

    clothesContextStr = clothesContextStr.trim();
    if (clothesContextStr) {
        const depth = parseInt(localStorage.getItem('clothes_depth') || '0', 10);
        stContext.setExtensionPrompt('clothes', `[System Note: Current Clothing / Outfits]\n${clothesContextStr}`, 1, depth);
    } else {
        delete stContext.extensionPrompts['clothes'];
    }

    // Do Locations
    let locContextStr = "";
    const activeLocations = getActiveItems('location');
    const injectMode = localStorage.getItem('location_inject_mode') || 'text';
    
    Object.keys(activeLocations).forEach(entityName => {
        const itemId = activeLocations[entityName];
        const item = clothesState.items.find(i => i.id === itemId);
        if (item && item.description) {
            // Always inject text description if available
            let namePart = item.name ? ` (${item.name})` : '';
            locContextStr += `${entityName}'s Location${namePart}:\n${item.description}\n\n`;
        }
    });

    locContextStr = locContextStr.trim();
    if (locContextStr) {
        const depth = parseInt(localStorage.getItem('location_depth') || '0', 10);
        stContext.setExtensionPrompt('clothes_locations', `[System Note: Current Locations]\n${locContextStr}`, 1, depth);
    } else {
        delete stContext.extensionPrompts['clothes_locations'];
    }
}

// --- IMAGE INJECTION FOR MULTIMODAL ---
function onChatCompletionPromptReady(eventData) {
    const injectMode = localStorage.getItem('location_inject_mode') || 'text';
    if (injectMode !== 'image') return;
    
    const { chat, dryRun } = eventData;
    if (dryRun || !chat || !Array.isArray(chat)) return;
    
    const activeLocations = getActiveItems('location');
    const imagesToInject = [];
    
    Object.keys(activeLocations).forEach(entityName => {
        const itemId = activeLocations[entityName];
        const item = clothesState.items.find(i => i.id === itemId);
        const itemImages = item ? (item.images && item.images.length > 0 ? item.images : (item.imageBase64 ? [item.imageBase64] : [])) : [];
        if (itemImages.length > 0) {
            imagesToInject.push({ entityName, item, itemImages });
        }
    });
    
    if (imagesToInject.length === 0) return;
    
    // Find the last system message or first user message to attach images to
    let targetIdx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].role === 'system') {
            targetIdx = i;
            break;
        }
    }
    if (targetIdx === -1) {
        // Fallback: find first user message
        for (let i = 0; i < chat.length; i++) {
            if (chat[i].role === 'user') {
                targetIdx = i;
                break;
            }
        }
    }
    if (targetIdx === -1) return;
    
    const msg = chat[targetIdx];
    
    // Convert content to array format if it's a string
    if (typeof msg.content === 'string') {
        msg.content = [{ type: 'text', text: msg.content }];
    }
    
    // Append images
    let totalInjected = 0;
    imagesToInject.forEach(({ entityName, item, itemImages }) => {
        itemImages.forEach(imgSrc => {
            msg.content.push({
                type: 'image_url',
                image_url: { url: imgSrc, detail: 'low' }
            });
            totalInjected++;
        });
        // Add a text label
        const namePart = item.name ? ` (${item.name})` : '';
        msg.content.push({
            type: 'text',
            text: `[${entityName}'s current location${namePart}]`
        });
    });
    
    console.log(`${LOG_PREFIX} Injected ${imagesToInject.length} location image(s) into prompt`);
}

function initializeExtension() {
    attachToUI();
    buildModal();
    loadState();
    updateSTScriptVariables();
    updateContext();
    
    if (typeof eventSource !== 'undefined') {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            updateContext();
            updateSTScriptVariables();
        });
        
        // Hook into prompt assembly to inject location images for multimodal
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
            onChatCompletionPromptReady(eventData);
        });
    }

    // --- FETCH INTERCEPTOR ---
    // Intercepts ALL chat-completion requests (including DreamAlbum's direct fetch)
    // and injects location images when image injection mode is enabled.
    const _originalFetch = window.fetch;
    window.fetch = async function(url, options) {
        if (typeof url === 'string' && url.includes('/api/backends/chat-completions/generate') && options?.body) {
            try {
                const injectMode = localStorage.getItem('location_inject_mode') || 'text';
                if (injectMode === 'image') {
                    const bodyObj = JSON.parse(options.body);
                    if (bodyObj.messages && Array.isArray(bodyObj.messages)) {
                        const injected = injectLocationImagesIntoMessages(bodyObj.messages);
                        if (injected) {
                            options = { ...options, body: JSON.stringify(bodyObj) };
                            console.log(`${LOG_PREFIX} [fetch interceptor] Injected location images into external request`);
                        }
                    }
                }
            } catch (e) {
                console.error(`${LOG_PREFIX} fetch interceptor error:`, e);
            }
        }
        return _originalFetch.call(this, url, options);
    };
}

/**
 * Injects location images into a messages array (used by fetch interceptor).
 * Returns true if images were injected.
 */
function injectLocationImagesIntoMessages(messages) {
    const activeLocations = getActiveItems('location');
    const imagesToInject = [];
    
    Object.keys(activeLocations).forEach(entityName => {
        const itemId = activeLocations[entityName];
        const item = clothesState.items.find(i => i.id === itemId);
        const itemImages = item ? (item.images && item.images.length > 0 ? item.images : (item.imageBase64 ? [item.imageBase64] : [])) : [];
        if (itemImages.length > 0) {
            imagesToInject.push({ entityName, item, itemImages });
        }
    });
    
    if (imagesToInject.length === 0) return false;
    
    // Find the best target: last system message, or first user message
    let targetIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'system') { targetIdx = i; break; }
    }
    if (targetIdx === -1) {
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'user') { targetIdx = i; break; }
        }
    }
    if (targetIdx === -1) return false;
    
    const msg = messages[targetIdx];
    
    // Convert content to array format if it's a string
    if (typeof msg.content === 'string') {
        msg.content = [{ type: 'text', text: msg.content }];
    }
    
    imagesToInject.forEach(({ entityName, item, itemImages }) => {
        itemImages.forEach(imgSrc => {
            msg.content.push({
                type: 'image_url',
                image_url: { url: imgSrc, detail: 'low' }
            });
        });
        const namePart = item.name ? ` (${item.name})` : '';
        msg.content.push({
            type: 'text',
            text: `[${entityName}'s current location${namePart}]`
        });
    });
    
    return true;
}

$(document).ready(() => {
    setTimeout(initializeExtension, 1500);
});
