# AnswerWithAI

A Vencord userplugin that adds **Answer with AI** to the message context menu. It uses recent conversation context to generate a casual Gemini reply and places that reply into the chat box without sending it.

The plugin uses a native main-process helper for the Gemini request.

## Quick Setup

Upload the plugin folder to the location where it belongs in your Vencord source tree, then run:

```powershell
Remove-Item -Recurse -Force dist
pnpm build
pnpm inject
```

After injection, enable `AnswerWithAI` in Vencord if needed.

## Installation

1. Put the plugin folder in `src/userplugins/<Name>/`.
2. Export a default `definePlugin` from `index.tsx` or `index.ts`.
3. Because the plugin makes a network request from the main process, include the native helper.
4. Export native IPC handlers through `VencordNative.pluginHelpers.<ExactPluginName>.<fn>`.
5. The native helper key must match the plugin name exactly: `AnswerWithAI`.
6. Use Vencord APIs such as `@api/*`, `@utils/*`, and `@webpack/common`.
7. Rebuild/reinject after making changes.

For development, `pnpm watch` can be used instead of a full rebuild.

## How It Works

### Message context menu

The plugin patches the global context menu for:

```text
navId="message"
```

It adds:

```text
Answer with AI
```

Selecting the action generates a reply based on the selected message and recent conversation context.

### Conversation context

`getRecentContext(channelId, aroundMessageId)` reads up to:

```text
CONTEXT_MESSAGE_COUNT = 10
```

recent messages from `MessageStore`, up to and including the selected message.

Empty messages are filtered out and the remaining messages are mapped to:

```text
{
    authorName,
    content
}
```

### Prompt construction

`buildPrompt` instructs Gemini to:

- Reply as the current user.
- Use `UserStore.getCurrentUser().username` as the current user's identity.
- Keep the response casual.
- Match the existing conversation tone.
- Avoid AI disclaimers.
- Return only the reply text.

### Gemini request

`callGemini` invokes:

```text
Native.makeGeminiRequest(apiKey, GEMINI_MODEL, prompt)
```

The native helper returns:

```text
{ status, data }
```

The generated response is extracted from:

```text
data.candidates[0].content.parts[0].text
```

The resulting text is trimmed before being inserted into the chat input.

### Inserting the reply

`insertTextIntoChatInputBox(reply)` places the generated response into the Discord chat input.

The message is **not automatically sent**, giving the user an opportunity to review or edit it first.

## Files

### `index.tsx`

Renderer-side implementation containing:

- Message context menu patch.
- Recent-message context retrieval.
- Prompt construction.
- Gemini request invocation.
- Chat input insertion.
- Settings.
- UI error handling.

### `Native.ts`

Main-process Electron implementation containing:

- Gemini HTTP request.
- `net.fetch` networking.
- Request/response handling.
- `{ status, data }` result format.

## Gemini API Request

The native helper posts to:

```text
https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=...
```

The request body uses the Gemini `generateContent` format:

```text
{
    contents: [
        {
            parts: [
                {
                    text: prompt
                }
            ],
            role: "user"
        }
    ]
}
```

The implementation reads the response as text first. If it contains JSON, it parses the JSON; otherwise it returns the trimmed raw response together with its status/content type.

## Native Networking

The Gemini request uses Electron's `net.fetch` rather than a renderer-side request.

This allows the request to bypass Discord page CSP restrictions while using Chromium's network/proxy stack.

## Settings

The plugin requires an `apiKey` setting containing a Gemini API key.

If the key is missing or the request fails, an error message is inserted into the chat input.

## Model

The configured model is:

```text
gemini-3.1-flash-lite
```

If that model returns a `404`, the implementation includes a commented hint to try another available Gemini model.

## Context Limits

Only the 10 most recent messages up to the selected message are included in the generated context.

This keeps the prompt focused while providing enough recent conversation for Gemini to match the ongoing discussion.

## Notes

- Native helper key: `"AnswerWithAI"`.
- Plugin name: `"AnswerWithAI"`.
- `GEMINI_MODEL = "gemini-3.1-flash-lite"`.
- Generated replies are inserted into the chat box but are never sent automatically.
- Context is limited to 10 recent messages up to the selected message.
