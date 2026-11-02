# Claude

T3 Code uses Claude Code's login and configuration. Start with the default provider
for one account; [provider setup](./install.md#providers) covers installation and
shared provider settings.

## Separate accounts or configurations

Use a separate Claude config directory for each account. This also works for named
presets that need different Claude settings or a router connection.

Keep your existing account in the default directory. On the environment's machine,
create the second login:

```bash
mkdir -p ~/.claude_personal
CLAUDE_CONFIG_DIR=~/.claude_personal claude auth login
```

Add another Claude instance in **Settings > Providers**:

| Instance        | Binary path | CLAUDE_CONFIG_DIR path |
| --------------- | ----------- | ---------------------- |
| Claude Work     | `claude`    | Leave empty            |
| Claude Personal | `claude`    | `~/.claude_personal`   |

An empty config-directory setting uses Claude Code's normal configuration. The
custom setting changes `CLAUDE_CONFIG_DIR`, leaving `HOME` and the system keychain
location intact. Use the same variable for the login command. Setting `HOME`
instead can put credentials where this provider will not find them.

Check the account reported in provider settings after signing in. Existing
threads can switch only between Claude instances with the same config directory.
Separate account directories stay isolated, including their local conversation
state. Claude does not have Codex's shared-home and shadow-home arrangement.

For presets that differ only in API keys or endpoints, use the instance's
**Environment variables**. Variable assignments do not belong in **Launch arguments**.

Claude Code's verbose mode can stay enabled when you use Claude for text generation, including
thread titles, branch names, commit messages, and pull request descriptions. On a remote connection,
T3 Code uses the Claude configuration on the connected server.

## Compact long conversations

Set **Auto-compact after** in the Claude provider settings to an integer between
`100000` and `1000000`. For example, `300000` asks Claude to summarize at about
300,000 tokens. This changes when compaction happens, not the model's context
window. Leave it empty for Claude Code's default.

You can also send `/compact` in an existing conversation. Web and desktop offer
**Compact context** from the context meter. The meter is off by default; see
[commands and skills](./composer.md#commands-and-skills) to enable it. Claude Code
compacts automatically whether the meter is on or off.

When you return to a large thread after Claude's prompt cache expires, a
**Compact** chip with the thread's token count shows
next to the send button. While it is on, Enter summarizes the history first, then
sends your message. Click the chip to switch it to **Full** and keep the full
history for that message. The cache lasts about an hour on a Claude
subscription and 5 minutes with an API key, Bedrock, or Vertex. See [commands and skills](./composer.md#commands-and-skills) for using
composer commands.

**Compact idle threads** in **Settings > Providers > Advanced** controls this for threads
over 200,000 tokens. Each Claude provider's settings can override it:

- **When you return** shows the **Compact** chip described above. This is the default.
- **Before the cache expires (beta)** compacts an idle thread shortly before its
  prompt cache expires, so coming back does not reprocess the whole conversation.
  The compaction appears in the thread as a `/compact` turn sent by T3 Code.
- **Never** skips idle compaction and Claude's resume prompt. **Auto-compact after**
  still applies, and you can still compact by hand.

## Usage limits

If your Claude subscription runs out of usage mid-turn, the thread shows which
limit was reached and the remaining wait when Claude provides a reset time.
Claude Code holds the turn until that window reopens, so it can keep showing as
working. Wait for the reset, or stop the turn and continue later. The warning's
timestamp shows when the displayed wait started.

## Skills

Claude skills come from the config directory's `skills` folder and the project's
`.claude/skills` folder. If both define the same name, the config-directory copy
wins. Skills disabled in Claude's settings do not appear in the composer.

Use `$` in the composer to select a skill. Enabled installed Claude plugins also
contribute skills under names such as `plugin:review`. Skills marked `disable-model-invocation`
can still be started by you. Invoke those one per message: Claude directly runs
only the last named skill and may try to start earlier ones through its Skill
tool, which refuses skills reserved for manual invocation.

## Task lists

To show Claude task lists in the web and desktop apps, add
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` under **Variables** in the Claude instance's
**Environment** section in **Settings > Providers**. Each update shows as a Tasks
row in the thread; open it to see every step.

## claude.ai docs for other agents

In the desktop app, Codex and other non-Claude agents can create, read and edit your
claude.ai docs through your own Claude Code login. Turn on **Claude artifacts** in
**Settings > Browser**. T3 Code saves the setting, then opens claude.ai in the browser
panel so you can sign in there. Use **Sign in** on that row again if the panel's login
expires.

It uses two separate logins. Agents reach your docs through a Claude provider signed
in with a claude.ai account; an API key, Bedrock or a custom endpoint does not work.
Run `claude /login` if the setting says no account is signed in. The browser panel
keeps its own claude.ai sign-in, which is what lets doc links open signed in. Links to
claude.ai docs open in the browser panel even when other links open in your default
browser. Hold ⌘ or Ctrl while clicking to open one in your default browser.

Edits are checked after Claude Code makes them, not before. If an edit reached another
doc or its result was lost, the agent hears that and should check the doc on claude.ai.

Agents see the tools in sessions that start after you turn it on. Turning it off
removes the tools and returns doc links to your usual setting. It does not sign you
out of claude.ai, in the panel or in Claude Code, or delete docs. To remove the browser sign-in, use **Clear cookies and cache** on the
Default profile in **Settings > Browser**. Claude threads use claude.ai docs natively and
never get these tools.

## OpenRouter

Create a Claude instance with its own config directory, such as
`~/.claude_openrouter`, and keep **Binary path** set to `claude`. In that instance's
**Environment variables**, use:

| Variable               | Value                                     |
| ---------------------- | ----------------------------------------- |
| `ANTHROPIC_BASE_URL`   | `https://openrouter.ai/api`               |
| `ANTHROPIC_AUTH_TOKEN` | Your OpenRouter API key, marked Sensitive |
| `ANTHROPIC_API_KEY`    | An explicitly empty value                 |

If that Claude config directory has a cached Anthropic login, run `/logout` in a
Claude Code session using that directory before starting the router setup. Cached
login credentials can conflict with the router token.

Select the model you want in T3 Code. For an OpenRouter model outside the built-in
list, open that Claude instance in **Settings > Providers** and add its full model
ID with **Add custom model**. Then select it in the chat model picker.
`ANTHROPIC_DEFAULT_*_MODEL` variables map Claude Code aliases such as `sonnet`; they
do not replace the explicit model ID selected in T3 Code. Custom models may have
fewer effort, thinking, or context controls than built-in models.

Verify the model used in OpenRouter's activity dashboard. For current compatibility
requirements, use the
[OpenRouter Claude Code guide](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration).

## Other routers

A local router uses an ordinary Claude provider instance. Give it a separate
config directory and put the router's endpoint and credential variables in that
instance's **Environment variables**. The router must run where the environment
can reach it. Follow the [Claude Code Router instructions](https://github.com/musistudio/claude-code-router)
for its installation and routing configuration.
