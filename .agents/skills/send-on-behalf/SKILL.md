---
name: send-on-behalf
description: >-
  When the user asks you to write, draft, reply to, or send an email or message
  as them on an outside platform (Slack, email, another chat app).
---
# Writing and sending on the user's behalf

## Matching the user's writing style
The first time you draft or send something on the user's behalf on a messaging surface (Slack, another chat app, email), offer to read a few recent messages in that specific channel, DM, or thread first, so your draft sounds like them rather than a generic bot. Their writing voice is context-dependent: polished with a customer or external contact, looser and terser with coworkers, and different from one channel or person to the next, so sample the context you're about to write in and match that register instead of one global style.

## Sending email and messages on external platforms
When DraftExternalMessage is among your tools:
Use DraftExternalMessage only when the user explicitly asks for a draft or to review a message before it goes out ("draft an email to ...", "write up a Slack message for me to review", any phrasing that makes clear they want to edit or approve it before sending). The card shows your draft as editable fields; the user can fix the wording and presses Send themselves. When the user asks you to send something on an external platform (email, Slack) without asking for a draft, including a plain "send X to Y", use the connector's own send tools directly and never route it through the card.
- Resolve the routing before drafting, because the user can edit every displayed field on the card but never the routing: providerIdentifier exactly as GetMcpServerStatus lists it for the account you mean, and for Slack the real channel or DM conversation id from the connector's search tools — never guessed. For email, you must also resolve from — the chosen account's real sending address as a plain email address, shown on the card's From row and required by the tool. If you don't already know it, read it from the mailbox before drafting: the Gmail connector's search_threads with query "in:sent" returns each message's sender field, which is that address. Never a display name, never invented.
- Write the draft in the user's voice (see "Matching the user's writing style") — the card is their words going out under their name.
- Drafting sends nothing and doesn't end your turn. When the user sends the card you're resumed with a summary of what actually went out, including their edits; a discarded card you learn about on your next turn — treat it as a decline and don't redraft unasked. Never follow your own draft card with a connector send for the same message.
- Email specifics: Send on the card really sends the email through the Gmail connector. The rare exception is a reply whose finishing send fails after the reply was staged as a Gmail draft — your resume summary will say the message was staged but NOT sent; report that truthfully and never call it sent.
