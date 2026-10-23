/**
 * Preview image generation for the wardrobe.
 *
 * The connection (provider, endpoint, key, model) and the active style come from
 * SillyImages (extensionSettings.inline_image_gen). It is only ever read, never
 * modified: SillyImages updates itself and keeps its generators private, so the
 * few provider calls it makes are repeated here instead.
 *
 * Nothing in this file touches the DOM or the wardrobe state, so it can be tested
 * on its own.
 */

export const IIG_MODULE_NAME = 'inline_image_gen';
export const PREVIEW_ASPECT_RATIO = '1:1';
export const PREVIEW_CATEGORIES = ['outfit', 'hairstyle', 'accessory', 'makeup'];

const MAX_REFERENCE_IMAGES = 5;
const REQUEST_TIMEOUT_MS = 180000;
const VALID_IMAGE_SIZES = ['1K', '2K', '4K'];
const NAISTERA_MODELS = ['grok', 'grok-pro', 'nano banana', 'novelai'];

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------
// Placeholders:
//   {{style}}           the active SillyImages style, or the built-in one below
//   {{description}}     the item's description
//   {{reference_note}}  "the reference shows the exact character", only when a
//                       reference image is attached; empty otherwise

export const DEFAULT_STYLE_TEXT = 'expressive painterly digital illustration, modern concept art aesthetic, unified painterly art style across entire canvas, all environment and background elements rendered in matching loose concept brushwork with simplified stylized forms, visible construction sketch lines underneath paint layers, razor-sharp hard edges with angular lasso-tool plane blocking, bold chisel-edge square brushwork, flat graphic color cutouts contrasted with soft facial gradient transitions, smooth porcelain matte skin with subtle warm blush and minimal sharp specular dots on nose tip and lips, hair built from broad geometric angular brush ribbons with faceted jagged tips and loose erratic flyaway sketch lines, sharp graphic cat-eye rendering with heavy dark upper lash contour, luminous flat-plane iris with subtle depth and pinpoint catchlights, high-contrast graphic lighting, stark hard cast shadow cutouts, dramatic dark value masses, dynamic edge contrast, rich saturated midtones, raw digital paint tactility.';

const NEGATIVE_TEXT = 'photograph, realistic photo background, photorealistic environment, photographic textures, 3d interior render, stock photo backdrop, composite collage, raytracing, 3d render, cgi, octane render, soft 3d, volumetric airbrush, smooth rounded tubes, soft blurry lighting, overblended gradients, smudged paint, smooth airbrushed skin, plastic wax, muddy blending, photorealism, heavy pores, cartoon outlines, children book illustration, flat vector art, washed out low contrast, desaturated dull shadows.';

const OUTFIT_TEMPLATE = `STYLE: {{style}}

NEGATIVE: ${NEGATIVE_TEXT}

CAMERA_AND_ANGLE: Eye-level composite studio shot featuring a full-body view on the left and an angled bust shot on the right.

COLOR_AND_LIGHTING: Soft, diffused studio front-lighting with subtle contouring shadows. Warm earth-toned palette with neutral, balanced tones and no color cast.

BACKGROUND_AND_ENVIRONMENT: Plain, flat, light-gray seamless studio backdrop.

FIGURE 1:
- Position & Gravity: Standing upright on the left, weight shifted slightly onto its left leg.
- Head & Expression: Head facing front, direct gaze at the camera. Neutral expression, lips slightly relaxed.
- Anatomical Mapping: Torso straight. Left arm resting straight down at its side. Right arm hanging loosely along the thigh. Left leg straight; right leg relaxed with knee slightly bent.

FIGURE 2:
- Position & Gravity: Cropped bust view in the right foreground, angled in a three-quarter turn.
- Head & Expression: Head tilted gently toward its left, gaze locked forward. Relaxed, calm expression.
- Anatomical Mapping: Upper torso angled forward. Arms resting downward alongside the torso, cropped at mid-thigh.

OUTFIT: {{description}}

FORMAT: 1/1

{{reference_note}}`;

const HAIRSTYLE_TEMPLATE = `STYLE: {{style}}

NEGATIVE: ${NEGATIVE_TEXT}

CAMERA_AND_ANGLE: Eye-level composite studio shot featuring a front view of the head and shoulders on the left and a rear three-quarter view of the head on the right, so the whole hairstyle can be read from both sides.

COLOR_AND_LIGHTING: Soft, diffused studio front-lighting with gentle contouring shadows that reveal the volume, layering and parting of the hair. Neutral, balanced tones and no color cast.

BACKGROUND_AND_ENVIRONMENT: Plain, flat, light-gray seamless studio backdrop.

FIGURE 1:
- Position & Gravity: Upright head-and-shoulders view on the left, shoulders level.
- Head & Expression: Head facing front, direct gaze at the camera. Neutral expression, lips slightly relaxed.
- Anatomical Mapping: Shoulders squared, wearing a plain neutral fitted top that does not draw attention away from the hair. No hat and no hair accessories unless they are part of the description below.

FIGURE 2:
- Position & Gravity: Head-and-shoulders view on the right, turned away in a rear three-quarter angle.
- Head & Expression: Head turned slightly back over the shoulder so the back and the side of the hairstyle are fully visible. Relaxed, calm expression.
- Anatomical Mapping: Same plain neutral top, cropped at the upper back.

HAIRSTYLE: {{description}}

FORMAT: 1/1

{{reference_note}}`;

const ACCESSORY_TEMPLATE = `STYLE: {{style}}

NEGATIVE: ${NEGATIVE_TEXT}

CAMERA_AND_ANGLE: Eye-level composite studio shot featuring a full-body view on the left and an angled bust shot on the right, framed so that every accessory is clearly visible.

COLOR_AND_LIGHTING: Soft, diffused studio front-lighting with subtle contouring shadows that show the material and finish of each piece. Neutral, balanced tones and no color cast.

BACKGROUND_AND_ENVIRONMENT: Plain, flat, light-gray seamless studio backdrop.

FIGURE 1:
- Position & Gravity: Standing upright on the left, weight shifted slightly onto its left leg.
- Head & Expression: Head facing front, direct gaze at the camera. Neutral expression, lips slightly relaxed.
- Anatomical Mapping: Torso straight, arms resting loosely at the sides so nothing hides the accessories. Wearing a plain, close-fitting neutral base outfit in muted grey that does not compete with the accessories.

FIGURE 2:
- Position & Gravity: Cropped bust view in the right foreground, angled in a three-quarter turn.
- Head & Expression: Head tilted gently to one side, gaze locked forward. Relaxed, calm expression.
- Anatomical Mapping: Upper torso angled slightly forward, same plain neutral base outfit.

ACCESSORIES: {{description}}

FORMAT: 1/1

{{reference_note}}`;

const MAKEUP_TEMPLATE = `STYLE: {{style}}

NEGATIVE: ${NEGATIVE_TEXT}

CAMERA_AND_ANGLE: Eye-level composite studio beauty shot featuring a front-facing close-up of the face on the left and a three-quarter angled close-up of the face on the right, both framed from the collarbones up.

COLOR_AND_LIGHTING: Soft, even beauty lighting with gentle contouring shadows that keep the makeup colors and textures accurate. Neutral, balanced tones and no color cast.

BACKGROUND_AND_ENVIRONMENT: Plain, flat, light-gray seamless studio backdrop.

FIGURE 1:
- Position & Gravity: Centered face close-up on the left, shoulders level.
- Head & Expression: Head facing front, direct gaze at the camera. Neutral expression, lips slightly relaxed.
- Anatomical Mapping: Hair pulled back and away from the face so nothing covers the makeup. Plain neutral top, cropped at the collarbones.

FIGURE 2:
- Position & Gravity: Close-up on the right, turned in a three-quarter angle.
- Head & Expression: Head tilted gently toward its left, gaze locked forward. Relaxed, calm expression.
- Anatomical Mapping: Same hair pulled back, same plain neutral top, cropped at the collarbones.

MAKEUP: {{description}}

FORMAT: 1/1

{{reference_note}}`;

export const DEFAULT_PREVIEW_TEMPLATES = Object.freeze({
    outfit: OUTFIT_TEMPLATE,
    hairstyle: HAIRSTYLE_TEMPLATE,
    accessory: ACCESSORY_TEMPLATE,
    makeup: MAKEUP_TEMPLATE,
});

const REFERENCE_NOTE = 'CRITICAL: The reference image shows the EXACT appearance of the character.';

/**
 * Fills a template. A single pass over the placeholders, so text inserted for one
 * of them (a description with "$&" or "{{style}}" in it) is never re-interpreted.
 */
export function buildPreviewPrompt({ template, style, description, hasReference }) {
    let text = String(template || '');
    // A custom template that forgot these would silently ignore the description or the reference
    if (!text.includes('{{description}}')) text += '\n\nDESCRIPTION: {{description}}';
    if (hasReference && !text.includes('{{reference_note}}')) text += '\n\n{{reference_note}}';

    const values = {
        style: String(style || '').trim(),
        description: String(description || '').trim(),
        reference_note: hasReference ? REFERENCE_NOTE : '',
    };
    text = text.replace(/\{\{(style|description|reference_note)\}\}/g, (_m, key) => values[key]);

    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The style to draw in: SillyImages' active style when its "force style" switch is
 * on (the same rule SillyImages applies to chat images), otherwise the built-in one.
 */
export function resolveStyle(iigSettings) {
    const s = iigSettings || {};
    if (s.forceStyleEnabled && Array.isArray(s.forcedStyles) && s.forcedStyles.length > 0) {
        const active = s.forcedStyles.find(st => st && st.id === s.activeForcedStyleId) || s.forcedStyles[0];
        const prompt = String(active?.prompt || '').trim();
        if (prompt) {
            return { text: prompt, source: 'sillyimages', name: String(active.name || '').trim() || 'Unnamed style' };
        }
    }
    return { text: DEFAULT_STYLE_TEXT, source: 'builtin', name: 'Built-in painterly style' };
}

// ---------------------------------------------------------------------------
// Connection (read from SillyImages)
// ---------------------------------------------------------------------------

function isGeminiModel(modelId) {
    return String(modelId || '').toLowerCase().includes('nano-banana');
}

function normalizeNaisteraModel(model) {
    const raw = String(model || '').trim().toLowerCase();
    if (!raw) return 'grok';
    if (raw === 'grok pro' || raw === 'grok-pro' || raw === 'grok-imagine-pro' || raw === 'imagine-pro') return 'grok-pro';
    if (raw === 'nano-banana' || raw === 'nano-banana-pro' || raw === 'nano-banana-2' || raw === 'nano banana pro' || raw === 'nano banana 2') return 'nano banana';
    if (raw === 'novel ai' || raw === 'novelai') return 'novelai';
    if (NAISTERA_MODELS.includes(raw)) return raw;
    return 'grok';
}

function naisteraModelSupportsReferences(model) {
    const normalized = normalizeNaisteraModel(model);
    return normalized !== 'novelai' && normalized !== 'grok-pro';
}

/**
 * Works out which provider call to make from SillyImages' settings, the same way
 * SillyImages does. Returns { ok: false, error } when it isn't usable.
 */
export function getImageGenConfig(extensionSettings) {
    const s = extensionSettings?.[IIG_MODULE_NAME];
    if (!s || typeof s !== 'object') {
        return { ok: false, error: 'SillyImages has no settings yet. Install it and set up its connection first.' };
    }

    const apiType = ['openai', 'gemini', 'naistera'].includes(s.apiType) ? s.apiType : 'openai';
    // SillyImages also sends nano-banana models through the Gemini call, whatever the API type says
    const route = apiType === 'naistera'
        ? 'naistera'
        : (apiType === 'gemini' || isGeminiModel(s.model)) ? 'gemini' : 'openai';

    const endpointRaw = String(s[`${route}Endpoint`] || s.endpoint || '').trim().replace(/\/+$/, '');
    const apiKey = String(s[`${route}ApiKey`] || s.apiKey || '').trim();
    const model = String(s[`${route}Model`] || s.model || '').trim();

    const problems = [];
    if (route !== 'naistera' && !endpointRaw) problems.push('endpoint URL');
    if (!apiKey) problems.push('API key');
    if (route !== 'naistera' && !model) problems.push('model');
    if (problems.length > 0) {
        return { ok: false, error: `SillyImages connection is incomplete: missing ${problems.join(', ')}.` };
    }

    const imageSize = VALID_IMAGE_SIZES.includes(s.imageSize) ? s.imageSize : '1K';
    const retries = Number.parseInt(s.maxRetries, 10);
    const delay = Number.parseInt(s.retryDelay, 10);

    const config = {
        ok: true,
        route,
        apiKey,
        imageSize,
        quality: s.quality || 'standard',
        maxRetries: Number.isFinite(retries) ? Math.min(Math.max(retries, 0), 5) : 0,
        retryDelay: Number.isFinite(delay) && delay >= 0 ? delay : 1000,
    };

    if (route === 'naistera') {
        const base = (endpointRaw || 'https://naistera.org').replace(/\/api\/generate$/i, '');
        config.url = `${base}/api/generate`;
        config.model = normalizeNaisteraModel(s.naisteraModel || s.model);
        config.supportsReferences = naisteraModelSupportsReferences(config.model);
    } else if (route === 'gemini') {
        config.url = `${endpointRaw}/v1beta/models/${model}:generateContent`;
        config.model = model;
        config.supportsReferences = true;
    } else {
        config.url = `${endpointRaw}/v1/images/generations`;
        config.model = model;
        config.supportsReferences = false;
    }

    config.label = `${route} · ${config.model}`;
    return config;
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

async function postJson(url, headers, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (e) {
        if (e?.name === 'AbortError') throw new Error('Request timeout: the image provider did not answer in time.');
        throw new Error(`Network error while contacting the image provider (${e?.message || e}).`);
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`API Error (${response.status}): ${text.slice(0, 300)}`);
    }
    return response.json();
}

async function requestGemini(cfg, prompt, references) {
    const parts = references.map(r => ({ inlineData: { mimeType: r.mimeType, data: r.data } }));
    parts.push({ text: prompt });

    const result = await postJson(cfg.url, {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'x-goog-api-key': cfg.apiKey,
        'Content-Type': 'application/json',
    }, {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: PREVIEW_ASPECT_RATIO, imageSize: cfg.imageSize },
        },
    });

    const candidates = result.candidates || [];
    if (candidates.length === 0) throw new Error('No candidates in the provider response (the request may have been blocked).');

    const responseParts = candidates[0].content?.parts || [];
    for (const part of responseParts) {
        if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        if (part.inline_data) return `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
    }

    const textPart = responseParts.find(p => p.text);
    if (textPart) {
        const match = textPart.text.match(/!\[.*?\]\((.*?)\)/) || textPart.text.match(/(https?:\/\/[^\s)]+)/);
        if (match) return match[1];
    }
    throw new Error('The provider answered without an image.');
}

async function requestOpenAI(cfg, prompt) {
    const result = await postJson(cfg.url, {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
    }, {
        model: cfg.model,
        prompt,
        n: 1,
        size: '1024x1024',
        quality: cfg.quality,
        response_format: 'b64_json',
    });

    const first = (result.data || [])[0];
    if (!first) {
        if (result.url) return result.url;
        throw new Error('No image data in the provider response.');
    }
    if (first.b64_json) return `data:image/png;base64,${first.b64_json}`;
    if (first.url) return first.url;
    throw new Error('No image data in the provider response.');
}

async function requestNaistera(cfg, prompt, references) {
    const body = { prompt, aspect_ratio: PREVIEW_ASPECT_RATIO, model: cfg.model };
    if (references.length > 0) {
        body.reference_images = references.map(r => `data:${r.mimeType};base64,${r.data}`);
    }

    const result = await postJson(cfg.url, {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
    }, body);

    if (!result?.data_url) throw new Error('No data_url in the provider response.');
    if (result.media_kind === 'video') throw new Error('The provider returned a video; pick an image model in SillyImages.');
    return result.data_url;
}

function isRetryable(error) {
    const msg = String(error?.message || '').toLowerCase();
    return ['429', '502', '503', '504', 'timeout', 'network'].some(k => msg.includes(k));
}

/**
 * Generates one square image. `references` is a list of { mimeType, data } (raw
 * base64). Resolves to a data URL, or an http(s) URL when the proxy returns a link
 * (see resolveToDataUrl).
 */
export async function generatePreviewImage(cfg, prompt, references = [], onStatus) {
    if (!cfg?.ok) throw new Error(cfg?.error || 'The image connection is not configured.');

    const refs = cfg.supportsReferences ? references.slice(0, MAX_REFERENCE_IMAGES) : [];
    let lastError;

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
            onStatus?.(attempt > 0 ? `Generating (retry ${attempt}/${cfg.maxRetries})...` : 'Generating...');
            if (cfg.route === 'naistera') return await requestNaistera(cfg, prompt, refs);
            if (cfg.route === 'gemini') return await requestGemini(cfg, prompt, refs);
            return await requestOpenAI(cfg, prompt);
        } catch (error) {
            lastError = error;
            if (!isRetryable(error) || attempt === cfg.maxRetries) break;
            const wait = cfg.retryDelay * Math.pow(2, attempt);
            onStatus?.(`Retrying in ${Math.round(wait / 100) / 10}s...`);
            await new Promise(resolve => setTimeout(resolve, wait));
        }
    }
    throw lastError;
}

/** Turns whatever the provider returned into a data URL. */
export async function resolveToDataUrl(result) {
    if (typeof result !== 'string' || !result) throw new Error('The provider returned nothing usable.');
    if (result.startsWith('data:')) return result;

    const response = await fetch(result);
    if (!response.ok) throw new Error(`Could not download the generated image (${response.status}).`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the generated image.'));
        reader.readAsDataURL(blob);
    });
}

/** "data:image/png;base64,AAAA" -> { mimeType: 'image/png', data: 'AAAA' } */
export function splitDataUrl(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    if (!String(dataUrl).startsWith('data:') || comma === -1) throw new Error('Not a data URL.');
    const mimeType = dataUrl.slice(5, comma).split(';')[0] || 'image/png';
    return { mimeType, data: dataUrl.slice(comma + 1).trim() };
}

// ---------------------------------------------------------------------------
// References (read from SillyImages)
// ---------------------------------------------------------------------------

function normalizeKeywords(value, legacyName = '') {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim() ? [value] : []);
    const list = source.length > 0 ? source : (legacyName ? [legacyName] : []);

    const seen = new Set();
    const result = [];
    for (const raw of list) {
        const word = String(raw || '').trim();
        const lower = word.toLowerCase();
        if (!word || seen.has(lower)) continue;
        seen.add(lower);
        result.push(word);
    }
    return result;
}

function toEntry(raw, chatLabel, group) {
    if (!raw || typeof raw !== 'object') return null;
    const names = normalizeKeywords(raw.keywords, raw.name);
    const src = raw.imagePath
        ? String(raw.imagePath)
        : (raw.imageBase64 ? `data:image/jpeg;base64,${raw.imageBase64}` : '');
    return { names, name: names[0] || '', src, key: imageKey(src), chatLabel, group };
}

/** Same image, same key: a file path, or a fingerprint for old inline base64. */
function imageKey(src) {
    if (!src) return '';
    return src.startsWith('data:') ? `b64:${src.length}:${src.slice(0, 96)}` : src;
}

/** Which SillyImages bucket the current chat's references live in. */
export function getReferenceChatKey(ctx) {
    if (!ctx) return 'default';
    if (ctx.groupId) return String(ctx.groupId);

    if (ctx.characterId !== undefined && ctx.characterId !== null) {
        if (typeof ctx.characterId === 'number' && ctx.characters?.[ctx.characterId]) {
            const c = ctx.characters[ctx.characterId];
            return c.avatar || c.name || 'default';
        }
        if (typeof ctx.characterId === 'string') {
            const c = ctx.characters?.find(ch => ch.avatar === ctx.characterId || ch.name === ctx.characterId);
            return c?.avatar || c?.name || ctx.characterId;
        }
    }
    return 'default';
}

export function getChatLabel(key, ctx) {
    const character = ctx?.characters?.find(c => c?.avatar === key || c?.name === key);
    if (character?.name) return character.name;

    const group = ctx?.groups?.find(g => String(g?.id) === String(key));
    if (group?.name) return group.name;

    if (key === 'default') return 'No character';
    return String(key).replace(/\.(png|webp|jpe?g)$/i, '');
}

function entriesOfChat(data, label, group) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const slots = [data.charRef, data.userRef, ...(Array.isArray(data.npcs) ? data.npcs : [])];
    return slots.map(raw => toEntry(raw, label, group)).filter(Boolean);
}

/**
 * Every reference with a picture, sorted into the groups the picker shows.
 * An image appears once: first under "suggested", otherwise in the first group
 * that has it. `suggested` holds references named like `entityName` and the one
 * used last time.
 */
export function collectPreviewReferences(iigSettings, ctx, entityName = '', lastUsedKey = '') {
    const s = iigSettings || {};
    const store = s.npcReferences && typeof s.npcReferences === 'object' && !Array.isArray(s.npcReferences)
        ? s.npcReferences : {};
    const currentKey = getReferenceChatKey(ctx);

    const current = entriesOfChat(store[currentKey], getChatLabel(currentKey, ctx), 'current');
    const favorites = (Array.isArray(s.favoriteReferences) ? s.favoriteReferences : [])
        .map(raw => toEntry(raw, String(raw?.sourceLabel || '') || 'Favorites', 'favorites')).filter(Boolean);
    const archive = [];
    for (const [key, data] of Object.entries(store)) {
        if (key === currentKey) continue;
        archive.push(...entriesOfChat(data, getChatLabel(key, ctx), 'archive'));
    }
    archive.sort((a, b) => a.chatLabel.localeCompare(b.chatLabel) || a.name.localeCompare(b.name));

    const seen = new Set();
    const take = (list) => list.filter(e => {
        if (!e.src || seen.has(e.key)) return false;
        seen.add(e.key);
        return true;
    });

    const wanted = String(entityName || '').trim().toLowerCase();
    const isSuggested = (e) => (wanted && e.names.some(n => n.toLowerCase() === wanted))
        || (lastUsedKey && e.key === lastUsedKey);

    const all = [...current, ...favorites, ...archive].filter(e => e.src);
    const suggested = take(all.filter(isSuggested));

    return {
        suggested,
        current: take(current),
        favorites: take(favorites),
        archive: take(archive),
    };
}

/** Every name SillyImages knows (picture or not), the current chat's first. */
export function collectKnownReferenceNames(iigSettings, ctx) {
    const s = iigSettings || {};
    const store = s.npcReferences && typeof s.npcReferences === 'object' && !Array.isArray(s.npcReferences)
        ? s.npcReferences : {};
    const currentKey = getReferenceChatKey(ctx);

    const names = [];
    const seen = new Set();
    const addFrom = (entries) => entries.forEach(e => e.names.forEach(n => {
        const lower = n.toLowerCase();
        if (!seen.has(lower)) { seen.add(lower); names.push(n); }
    }));

    addFrom(entriesOfChat(store[currentKey], '', 'current'));
    const rest = [];
    for (const [key, data] of Object.entries(store)) {
        if (key !== currentKey) rest.push(...entriesOfChat(data, '', 'archive'));
    }
    const favs = (Array.isArray(s.favoriteReferences) ? s.favoriteReferences : []).map(r => toEntry(r, '', 'favorites')).filter(Boolean);

    const before = names.length;
    addFrom(favs);
    addFrom(rest);
    const tail = names.splice(before).sort((a, b) => a.localeCompare(b));
    return names.concat(tail);
}
