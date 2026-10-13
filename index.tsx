import { addGlobalContextMenuPatch, GlobalContextMenuPatchCallback, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Menu, MessageStore, UserStore } from "@webpack/common";

// If you get a 404 from Gemini, this model name is the likely cause -
// try e.g. "gemini-2.5-flash-lite" instead.
const GEMINI_MODEL = "gemini-3.1-flash-lite";

// pluginHelpers is keyed by the plugin's exact `name` (case-sensitive),
// which is "AnswerWithAI" below - not "answerWithAI".
const Native = VencordNative.pluginHelpers.AnswerWithAI as PluginNative<typeof import("./native")>;

const CONTEXT_MESSAGE_COUNT = 10;

const settings = definePluginSettings({
    apiKey: {
        type: OptionType.STRING,
        description: "Your Gemini API key (from Google AI Studio)",
        default: "",
    },
    addDisclaimer: {
        type: OptionType.BOOLEAN,
        description: "Append a disclaimer to AI-drafted replies",
        default: false,
    },
    disclaimerText: {
        type: OptionType.STRING,
        description: "Disclaimer text to append (only used if the option above is enabled)",
        default: "(AI-generated reply)",
    },
});

interface SimpleMessage {
    authorName: string;
    content: string;
}

function getRecentContext(channelId: string, aroundMessageId: string): SimpleMessage[] {
    const all: any[] = (MessageStore.getMessages(channelId) as any)?._array ?? [];

    const targetIndex = all.findIndex(m => m?.id === aroundMessageId);
    const upToTarget = targetIndex === -1 ? all : all.slice(0, targetIndex + 1);
    const recent = upToTarget.slice(-CONTEXT_MESSAGE_COUNT);

    return recent
        .filter(m => typeof m?.content === "string" && m.content.length > 0)
        .map(m => ({
            authorName: m.author?.username ?? "unknown",
            content: m.content,
        }));
}

function buildPrompt(context: SimpleMessage[], currentUserName: string): string {
    const transcript = context
        .map(m => `${m.authorName}: ${m.content}`)
        .join("\n");

    return `You are ${currentUserName}, replying casually in a Discord chat. ` +
        `You are NOT an AI assistant and should never mention being one, never add ` +
        `disclaimers, and never say things like "as an AI" or "I'm just a language model". ` +
        `Write the way a real person casually chatting on Discord would: short, natural, ` +
        `low-effort punctuation is fine, no markdown headers, no bullet lists unless the ` +
        `conversation itself is listy. Match the tone of the conversation below.

Here is the recent conversation, oldest message first:

${transcript}

Write ONLY the reply message itself - no quotation marks around it, no "Reply:" prefix, ` +
        `nothing else. Just the message text as it should appear in the chat box.`;
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
    const { status, data } = await Native.makeGeminiRequest(apiKey, GEMINI_MODEL, prompt);

    if (status !== 200) {
        throw new Error(`Gemini API error ${status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    }

    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no text content");
    return text.trim();
}

// The disclaimer is added in code (not via the prompt) so it is applied
// reliably and exactly as written, and the model itself stays unaware of it.
function applyDisclaimer(reply: string): string {
    if (!settings.store.addDisclaimer) return reply;

    const disclaimer = settings.store.disclaimerText?.trim();
    if (!disclaimer) return reply;

    return `${reply} ${disclaimer}`;
}

async function handleAnswerWithAi(message: any) {
    const apiKey = settings.store.apiKey?.trim();
    if (!apiKey) {
        insertTextIntoChatInputBox("[AI Reply] Set your Gemini API key in Vencord settings first.");
        return;
    }

    const channelId: string = message.channel_id;
    const currentUser = UserStore.getCurrentUser();
    const context = getRecentContext(channelId, message.id);

    if (context.length === 0) {
        insertTextIntoChatInputBox("[AI Reply] Couldn't find message context to reply to.");
        return;
    }

    const prompt = buildPrompt(context, currentUser?.username ?? "you");

    try {
        const reply = await callGemini(prompt, apiKey);
        // Inserts into the chat box without sending.
        insertTextIntoChatInputBox(applyDisclaimer(reply));
    } catch (err: any) {
        console.error("[AnswerWithAI]", err);
        insertTextIntoChatInputBox(`[AI Reply] Failed: ${err?.message ?? err}`);
    }
}

const globalPatch: GlobalContextMenuPatchCallback = (navId, children, props) => {
    if (navId !== "message") return;

    const message = (props as any)?.message;
    if (!message) return;

    children.push(
        <Menu.MenuGroup key="answer-with-ai-group">
            <Menu.MenuItem
                id="vc-answer-with-ai"
                label="Answer with AI"
                action={() => handleAnswerWithAi(message)}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "AnswerWithAI",
    description: "Right-click a message to draft a casual AI reply (via Gemini) into your chat box without sending it.",
    authors: [{ name: "Your Name", id: 0n }],
    settings,

    start() {
        addGlobalContextMenuPatch(globalPatch);
    },

    stop() {
        removeGlobalContextMenuPatch(globalPatch);
    }
});
