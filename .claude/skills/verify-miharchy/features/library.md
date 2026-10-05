# Library

The Library view (key `1`): a cover grid of the server's library manga with unread badges, a category switcher, and removal.

## Sub-features
- Cover grid with unread-chapter badges (`unreadCount`), placeholder tiles for missing covers.
- Category switcher (`Tab` / `Shift-Tab`): All, Default, then user categories.
- `x` twice removes the manga under the cursor from the library; any other key disarms.
- `Enter` opens the manga detail (cache only).

## How to get to it (user POV)
Open the window; it starts on Library. Or press `1`.

## Driving it with drive.sh
```js
[
  [4000, function() { log("library", root.connection.manga.map(function(m) { return [m.title, m.unread] })); grab("library") }],
  [200,  function() { key("x") }],
  [200,  function() { key("x") }],
  [3000, function() { log("after-remove", root.connection.manga.length); grab("library-removed"); done() }]
]
```
Read back: `$S/gql.sh '{ mangas(condition:{inLibrary:true}){ totalCount nodes { title } } }'` — one fewer manga; its chapters' `isRead` unchanged.

## Gotchas
- The first manga's cover may still be loading at 4 s; grab later if covers matter.
- Covers load through `ServerImage` (files in `$XDG_RUNTIME_DIR/miharchy/images`), never URLs with credentials.
