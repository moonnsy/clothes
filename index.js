import { getContext } from '../../../extensions.js';
import { eventSource, event_types, generateRaw } from '../../../../script.js';

const extensionName = "Clothes";
const LOG_PREFIX = "[Clothes]";

let clothesState = {
    items: [], // { id, type, folder, name, description, imageBase64 }
    activeCharItemId: null, // Legacy global fallback
    activeUserItemId: null // Legacy global fallback
};

// --- CHAT SPECIFIC STATE ---
function getActiveItems() {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    if (stContext && stContext.chatMetadata) {
        if (!stContext.chatMetadata.clothes) stContext.chatMetadata.clothes = {};
        if (!stContext.chatMetadata.clothes.entities) stContext.chatMetadata.clothes.entities = {};
        
        // Migrate old char/user layout to entities if needed
        if (stContext.chatMetadata.clothes.char && !stContext.chatMetadata.clothes.entities[stContext.name2]) {
             stContext.chatMetadata.clothes.entities[stContext.name2 || 'Character'] = stContext.chatMetadata.clothes.char;
             delete stContext.chatMetadata.clothes.char;
        }
        if (stContext.chatMetadata.clothes.user && !stContext.chatMetadata.clothes.entities[stContext.name1]) {
             stContext.chatMetadata.clothes.entities[stContext.name1 || 'User'] = stContext.chatMetadata.clothes.user;
             delete stContext.chatMetadata.clothes.user;
        }
        
        return stContext.chatMetadata.clothes.entities;
    }
    
    // Global fallback
    if (!clothesState.activeEntities) clothesState.activeEntities = {};
    if (clothesState.activeCharItemId) {
        clothesState.activeEntities['Character'] = clothesState.activeCharItemId;
        clothesState.activeCharItemId = null;
    }
    if (clothesState.activeUserItemId) {
        clothesState.activeEntities['User'] = clothesState.activeUserItemId;
        clothesState.activeUserItemId = null;
    }
    return clothesState.activeEntities;
}

function setActiveItem(entityName, id) {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    if (stContext && stContext.chatMetadata) {
        if (!stContext.chatMetadata.clothes) stContext.chatMetadata.clothes = {};
        if (!stContext.chatMetadata.clothes.entities) stContext.chatMetadata.clothes.entities = {};
        
        if (id) {
            stContext.chatMetadata.clothes.entities[entityName] = id;
        } else {
            delete stContext.chatMetadata.clothes.entities[entityName];
        }
        
        if (typeof stContext.saveMetadataDebounced === 'function') stContext.saveMetadataDebounced();
    } else {
        if (!clothesState.activeEntities) clothesState.activeEntities = {};
        if (id) {
            clothesState.activeEntities[entityName] = id;
        } else {
            delete clothesState.activeEntities[entityName];
        }
        saveState();
    }
}

function getActiveTagFilter(entityName) {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    if (stContext && stContext.chatMetadata && stContext.chatMetadata.clothes && stContext.chatMetadata.clothes.tagFilters) {
        return stContext.chatMetadata.clothes.tagFilters[entityName] || null;
    }
    return clothesState.activeTagFilters ? clothesState.activeTagFilters[entityName] || null : null;
}

function setActiveTagFilter(entityName, tag) {
    const stContext = typeof getContext === 'function' ? getContext() : null;
    if (stContext && stContext.chatMetadata) {
        if (!stContext.chatMetadata.clothes) stContext.chatMetadata.clothes = {};
        if (!stContext.chatMetadata.clothes.tagFilters) stContext.chatMetadata.clothes.tagFilters = {};
        
        if (tag) {
            stContext.chatMetadata.clothes.tagFilters[entityName] = tag;
        } else {
            delete stContext.chatMetadata.clothes.tagFilters[entityName];
        }
        if (typeof stContext.saveMetadataDebounced === 'function') stContext.saveMetadataDebounced();
    } else {
        if (!clothesState.activeTagFilters) clothesState.activeTagFilters = {};
        if (tag) {
            clothesState.activeTagFilters[entityName] = tag;
        } else {
            delete clothesState.activeTagFilters[entityName];
        }
        saveState();
    }
}

let activeProfileName = '';
let currentView = 'gallery'; // 'gallery' | 'edit'
let editingItemId = null;
let currentEntity = '';
let currentType = 'char'; // 'char' | 'user'
let currentFolder = 'All'; // 'All' | folderName
let editingItemTags = []; // string[]

// --- STSCRIPT INTEGRATION ---
function updateSTScriptVariables() {
    const stContext = getContext();
    const userName = stContext && stContext.name1 ? stContext.name1 : "User";
    const charName = stContext && stContext.name2 ? stContext.name2 : "Character";

    const activeItems = getActiveItems();

    let userItemText = "";
    let charItemText = "";

    Object.keys(activeItems).forEach(entityName => {
        const itemId = activeItems[entityName];
        const item = clothesState.items.find(i => i.id === itemId);
        if (item) {
            let text = `${entityName}'s Outfit: ${item.name}`;
            if (item.tags && item.tags.length > 0) text += " (" + item.tags.join(", ") + ")";
            if (item.description) text += "\n" + item.description;

            if (entityName === userName) {
                userItemText = text;
            } else {
                if (charItemText) charItemText += "\n\n";
                charItemText += text;
            }
        }
    });

    const trySet = () => {
        try {
            const stContext = getContext();
            if (stContext && stContext.variables && stContext.variables.global && typeof stContext.variables.global.set === 'function') {
                stContext.variables.global.set('clothes_user', userItemText);
                stContext.variables.global.set('clothes_char', charItemText);
                return true;
            }
        } catch (e) {
            console.error(e);
        }
        return false;
    };

    if (!trySet()) {
        const iv = setInterval(() => {
            if (trySet()) clearInterval(iv);
        }, 500);
        setTimeout(() => clearInterval(iv), 5000);
    }
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
                    <h3><i class="fa-solid fa-shirt" style="margin-right:8px; color:var(--cl-accent);"></i>Clothes</h3>
                    <div style="display:flex; align-items:center;">
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
                    <div class="cl-gallery-header">
                        <select id="cl-folder-select" class="cl-select-field" style="max-width: 200px;">
                            <option value="All">All Outfits</option>
                        </select>
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

                    <div class="cl-image-uploader" id="cl-uploader-edit">
                        <i class="fa-solid fa-image"></i>
                        <span>Click to attach image</span>
                        <input type="file" id="cl-file-edit" accept="image/*" style="display:none;">
                        <img class="cl-image-preview" id="cl-preview-edit" src="">
                        <div class="cl-image-clear" id="cl-clear-edit" title="Remove image"><i class="fa-solid fa-xmark"></i></div>
                    </div>

                    <span class="cl-label">Outfit Name</span>
                    <input type="text" id="cl-name-edit" class="cl-input-field" placeholder="E.g., Casual Dress">

                    <span class="cl-label">Tags (Press Enter or + to add)</span>
                    <div style="display:flex; gap: 8px; align-items: stretch;">
                        <input type="text" id="cl-tags-input-edit" class="cl-input-field" placeholder="E.g., casual, summer, office..." style="flex-grow: 1; margin: 0;">
                        <button class="cl-btn cl-btn-secondary" id="cl-btn-add-tag" style="margin: 0; width: 45px; padding: 0; display:flex; align-items:center; justify-content:center; flex-shrink: 0;"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    <div class="cl-tags-container" id="cl-tags-list-edit"></div>
                    <div class="cl-suggested-tags" id="cl-tags-suggested-edit"></div>

                    <span class="cl-label">Outfit Description (Context)</span>
                    <textarea id="cl-desc-edit" class="cl-input-field" style="resize:vertical; min-height:80px;" placeholder="AI will describe the outfit here, or write manually..."></textarea>

                    <button class="cl-btn" id="cl-btn-describe-edit"><i class="fa-solid fa-wand-magic-sparkles"></i> Describe with AI</button>
                    <button class="cl-btn cl-btn-secondary" id="cl-btn-save-edit" style="margin-top: 10px;"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
                </div>

                <!-- SETTINGS PANE -->
                <div class="cl-content cl-view" id="cl-view-settings">
                    <span class="cl-label" style="margin-top:0;">Theme</span>
                    <select id="cl-setting-theme" class="cl-select-field">
                        <option value="blue">Blue (Default)</option>
                        <option value="grey">Grey</option>
                        <option value="rose">Rose</option>
                        <option value="emerald">Emerald</option>
                        <option value="auto">Tavern Auto</option>
                    </select>

                    <span class="cl-label">AI Description Prompt</span>
                    <select id="cl-setting-prompt" class="cl-select-field">
                        <option value="brief">Brief (Default)</option>
                        <option value="detailed">Detailed</option>
                    </select>

                    <span class="cl-label">Grid Columns (Mobile)</span>
                    <select id="cl-setting-grid" class="cl-select-field">
                        <option value="auto">Auto (Responsive)</option>
                        <option value="2">2 Columns</option>
                        <option value="3">3 Columns</option>
                    </select>

                    <span class="cl-label">Context Depth</span>
                    <input type="number" id="cl-setting-depth" class="cl-input-field" value="0" min="0" max="999">

                    <span class="cl-label">AI Description Max Tokens</span>
                    <input type="number" id="cl-setting-max-tokens" class="cl-input-field" value="4000" min="10" max="100000">

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
    $('#cl-btn-clear-all').on('click', () => {
        const stContext = getContext();
        if (stContext && stContext.chatMetadata && stContext.chatMetadata.clothes) {
            stContext.chatMetadata.clothes.entities = {};
            if (typeof stContext.saveMetadataDebounced === 'function') stContext.saveMetadataDebounced();
        } else {
            clothesState.activeEntities = {};
            saveState();
        }
        updateContext();
        updateSTScriptVariables();
        renderGallery();
        toastr.success("All outfits unequipped for this chat");
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

    $('#cl-setting-grid').on('change', function() {
        const val = $(this).val();
        localStorage.setItem('clothes_grid', val);
        renderGallery();
    });

    $('#cl-setting-depth').on('input change', function() {
        localStorage.setItem('clothes_depth', $(this).val());
        updateContext();
    });

    $('#cl-setting-max-tokens').on('input change', function() {
        localStorage.setItem('clothes_max_tokens', $(this).val());
    });

    $('#cl-folder-select').on('change', function() {
        currentFolder = $(this).val();
        setActiveTagFilter(currentEntity, null);
        renderGallery();
    });

    $('#cl-btn-back-gallery').on('click', () => {
        // Auto-save when going back
        saveCurrentEdit();
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

    // Uploader logic
    const $uploader = $('#cl-uploader-edit');
    const $file = $('#cl-file-edit');
    const $preview = $('#cl-preview-edit');
    const $clear = $('#cl-clear-edit');

    $uploader.on('click', (e) => {
        // Prevent infinite loops and don't trigger if clicking clear button
        if ($(e.target).is('input[type="file"]') || $(e.target).closest('.cl-image-clear').length > 0) return;
        $file.trigger('click');
    });

    $file.on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            $preview.attr('src', event.target.result).show();
            $clear.show();
            
            // Compress image to save memory and storage
            try {
                const compressedUrl = await compressImage(event.target.result, 800, 800, 0.7);
                $preview.attr('src', compressedUrl);
            } catch (err) {
                console.error("Clothes compression failed", err);
            }
        };
        reader.readAsDataURL(file);
        $(this).val(''); // Reset input so same file can be selected again
    });

    $clear.on('click', (e) => {
        e.stopPropagation();
        $preview.attr('src', '').hide();
        $clear.hide();
    });

    $('#cl-btn-describe-edit').on('click', () => describeImageEdit());

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

    const tabItems = clothesState.items.filter(item => item.type === currentType);
    
    // Manage Folders
    const folders = new Set();
    tabItems.forEach(item => { if (item.folder) folders.add(item.folder); });
    folders.add(currentEntity || 'Default');
    
    const $folderSelect = $('#cl-folder-select');
    $folderSelect.empty();
    $folderSelect.append(`<option value="All">All Outfits</option>`);
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

    // Tags filtering UI
    const tagsSet = new Set();
    folderItems.forEach(item => {
        if (item.tags && Array.isArray(item.tags)) {
            item.tags.forEach(t => tagsSet.add(t));
        }
    });

    const $tagsFilterContainer = $('#cl-gallery-tags-filter');
    $tagsFilterContainer.empty();
    
    let currentTagFilter = getActiveTagFilter(currentEntity);
    
    if (currentTagFilter && !tagsSet.has(currentTagFilter)) {
        setActiveTagFilter(currentEntity, null);
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
            setActiveTagFilter(currentEntity, t ? t : null);
            renderGallery();
        });
    } else {
        $tagsFilterContainer.hide();
        setActiveTagFilter(currentEntity, null);
        currentTagFilter = null;
    }

    // Filter Items by Tag
    const finalItems = currentTagFilter 
        ? folderItems.filter(item => item.tags && item.tags.includes(currentTagFilter))
        : folderItems;

    // Add New Card
    $grid.append(`
        <div class="cl-card cl-add-card" id="cl-grid-add">
            <i class="fa-solid fa-plus"></i>
            <span>Add New</span>
        </div>
    `);
    $('#cl-grid-add').on('click', () => openEditView(null));

    finalItems.forEach(item => {
        const activeItems = getActiveItems();
        const isActive = activeItems[currentEntity] === item.id;
        
        const imgSrc = item.imageBase64 || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        
        const $card = $(`
            <div class="cl-card ${isActive ? 'active-item' : ''}" data-id="${item.id}">
                <img class="cl-card-img" src="${imgSrc}">
                <div class="cl-card-info">
                    <div class="cl-card-title" title="${item.name}">${item.name || 'Unnamed'}</div>
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
            const activeItems = getActiveItems();
            setActiveItem(currentEntity, activeItems[currentEntity] === item.id ? null : item.id);
            updateContext();
            updateSTScriptVariables();
            
            // Update visually without rebuilding the DOM to prevent scroll jumps
            $('#cl-gallery-grid .cl-card').removeClass('active-item');
            const newActive = getActiveItems()[currentEntity];
            if (newActive) {
                $(`#cl-gallery-grid .cl-card[data-id="${newActive}"]`).addClass('active-item');
            }
        });

        // Edit
        $card.find('.cl-btn-edit').on('click', (e) => {
            e.stopPropagation();
            openEditView(item.id);
        });

        // Delete
        $card.find('.cl-btn-del').on('click', async (e) => {
            e.stopPropagation();
            const { Popup, POPUP_RESULT } = getContext();
            const result = await Popup.show.confirm("Delete this outfit?", "Confirm Deletion");
            if (result === POPUP_RESULT.AFFIRMATIVE) {
                const activeItems = getActiveItems();
                // Unequip from anyone currently wearing it
                Object.keys(activeItems).forEach(entity => {
                    if (activeItems[entity] === item.id) setActiveItem(entity, null);
                });
                
                clothesState.items = clothesState.items.filter(i => i.id !== item.id);
                saveState();
                updateSTScriptVariables();
                updateContext();
                renderGallery();
            }
        });

        $grid.append($card);
    });
}

// --- EDIT LOGIC ---
function openEditView(itemId) {
    editingItemId = itemId;
    editingItemTags = [];
    const stContext = getContext();
    
    if (itemId) {
        const item = clothesState.items.find(i => i.id === itemId);
        if (item) {
            $('#cl-name-edit').val(item.name || '');
            $('#cl-desc-edit').val(item.description || '');
            if (item.tags && Array.isArray(item.tags)) {
                editingItemTags = [...item.tags];
            }
            if (item.imageBase64) {
                $('#cl-preview-edit').attr('src', item.imageBase64).show();
                $('#cl-clear-edit').show();
            } else {
                $('#cl-preview-edit').attr('src', '').hide();
                $('#cl-clear-edit').hide();
            }
        }
    } else {
        // New item
        $('#cl-name-edit').val('');
        $('#cl-desc-edit').val('');
        
        $('#cl-preview-edit').attr('src', '').hide();
        $('#cl-clear-edit').hide();
    }
    
    $('#cl-tags-input-edit').val('');
    renderEditTags();
    showView('edit');
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
    const b64 = $('#cl-preview-edit').is(':visible') ? $('#cl-preview-edit').attr('src') : '';

    if (!name && !desc && !b64) {
        // Empty, don't save new
        if (!editingItemId) return;
    }

    if (editingItemId) {
        const item = clothesState.items.find(i => i.id === editingItemId);
        if (item) {
            item.name = name;
            item.description = desc;
            item.imageBase64 = b64;
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
            type: currentType,
            folder: folderName,
            name: name || 'New Outfit',
            description: desc,
            imageBase64: b64,
            tags: [...editingItemTags]
        };
        clothesState.items.push(newItem);
        editingItemId = newItem.id;
        
        const activeItems = getActiveItems();
        if (!activeItems[currentEntity]) {
            setActiveItem(currentEntity, newItem.id);
        }
    }
    
    saveState();
    updateSTScriptVariables();
    updateContext();
}

async function describeImageEdit() {
    const b64data = $('#cl-preview-edit').is(':visible') ? $('#cl-preview-edit').attr('src') : '';
    if (!b64data) {
        toastr.warning("Please attach an image first.");
        return;
    }

    const $btn = $('#cl-btn-describe-edit');
    const oldText = $btn.html();
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Describing...').prop('disabled', true);

    try {
        const promptType = localStorage.getItem('clothes_prompt') || 'brief';
        let prompt = "Please concisely describe the clothing and outfit worn by the main person in this image. Focus on style, colors, materials, and distinct accessories. Keep it under 5 sentences. Do not describe the person's physical features or background, ONLY the outfit.";
        
        if (promptType === 'detailed') {
            prompt = "Please provide a highly detailed, comprehensive breakdown of the clothing and outfit worn by the main person in this image. Describe every visible layer, including the style, cut, color, material, pattern, and any unique details (like buttons, stitching, or folds). Include all accessories such as jewelry, belts, hats, gloves, footwear, and any other wearable items. Do not describe the person's physical features, body shape, or background—focus strictly and exclusively on the garments and accessories. Provide your description in a single cohesive paragraph.";
        }
        
        let resultText = "";

        const stContext = getContext();
        if (!activeProfileName) {
            resultText = await generateRaw({ prompt: prompt, systemPrompt: '', imageList: [b64data] });
            if (!resultText) throw new Error("API returned empty response.");
        } else {
            const profiles = stContext?.extensionSettings?.connectionManager?.profiles || [];
            const profile = profiles.find(p => p.name === activeProfileName);
            if (!profile) throw new Error(`Profile '${activeProfileName}' not found.`);

            const cc_source = profile.api || 'openai';
            const messages = [{
                role: 'user', 
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: b64data } }
                ]
            }];

            const maxTokens = parseInt(localStorage.getItem('clothes_max_tokens') || '4000', 10);
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
    
    const grid = localStorage.getItem('clothes_grid') || 'auto';
    $('#cl-setting-grid').val(grid).trigger('change');
    
    const depth = localStorage.getItem('clothes_depth') || '0';
    $('#cl-setting-depth').val(depth);
    
    const maxTokens = localStorage.getItem('clothes_max_tokens') || '4000';
    $('#cl-setting-max-tokens').val(maxTokens);
    
    const showQuick = localStorage.getItem('clothes_quick_icon') === 'true';
    $('#cl-setting-quick-icon').prop('checked', showQuick);
    toggleQuickIcon(showQuick);
    
    // One-time compression for any massive legacy items
    setTimeout(async () => {
        let changed = false;
        for (let item of clothesState.items) {
            if (item.imageBase64 && item.imageBase64.length > 300000) { // ~300KB base64 check
                try {
                    item.imageBase64 = await compressImage(item.imageBase64, 800, 800, 0.7);
                    changed = true;
                } catch(e) {}
            }
        }
        if (changed) {
            saveState();
            console.log("Clothes extension compressed old large images.");
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

    let contextStr = "";
    const charName = stContext.name2 || "Character";
    const userName = stContext.name1 || "User";

    const activeItems = getActiveItems();

    Object.keys(activeItems).forEach(entityName => {
        const itemId = activeItems[entityName];
        const item = clothesState.items.find(i => i.id === itemId);
        if (item && item.description) {
            let namePart = item.name ? ` (${item.name})` : '';
            contextStr += `${entityName}'s Outfit${namePart}:\n${item.description}\n\n`;
        }
    });

    contextStr = contextStr.trim();
    
    if (contextStr) {
        const depth = parseInt(localStorage.getItem('clothes_depth') || '0', 10);
        // key, value, position (1 = IN_CHAT), depth
        stContext.setExtensionPrompt('clothes', `[System Note: Current Clothing / Outfits]\n${contextStr}`, 1, depth);
    } else {
        delete stContext.extensionPrompts['clothes'];
    }
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
    }
}

$(document).ready(() => {
    setTimeout(initializeExtension, 1500);
});
