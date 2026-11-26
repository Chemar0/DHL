# Parts List Project Map

This is a static parts-list website with a Supabase-backed shared cart, an approval gate, and separate administration screens. The annotations in source files explain each file's main responsibility; this guide groups the related files and describes their roles.

## Visitor journey and access control

- `index.html`, `landing.css`, and `landing.js` form the landing page and navigation into the two parts lists.
- `site-access.js` and `site-access.css` implement the access gate, account/session checks, request and approval flow, loading state, and transitions. Protected page scripts are loaded after access is confirmed.
- `supabase-config.js` supplies the browser-safe Supabase endpoint and publishable key. It must never contain a service-role key.
- `logo.svg` is the shared scalable brand artwork.

## Parts-list pages and catalog data

- `mechanical.html`, `ani.js`, `ani.css`, and `inventory.js` work together for the mechanical list. The HTML defines the tab panels, `inventory.js` supplies default catalog data, `ani.js` handles interactions and the cart, and `ani.css` styles the list and cart.
- `electrical.html`, `electrical.js`, `electrical-inventory.js`, and `cart-groups.css` work together for the electrical list. The inventory module supplies categories, default items, and metadata; the page controller handles tabs and cart behavior.
- `cart-groups.js` contains shared category/group normalization helpers used to keep cart entries identified as mechanical or electrical.
- `cart-user.js` maintains the browser's cart display name and device identifier for attribution. These are labels, not verified identities.

## Administration screens

- `admin.html`, `admin.css`, and `admin.js` are the mechanical inventory editor. The script reads, renders, and saves item names and catalog metadata.
- `electrical-admin.html` reuses the administration layout for the electrical list; `electrical-inventory.js` owns its editable electrical catalog structure and persistence/migration behavior.
- `accounts-admin.html`, `account-admin.js`, and `account-admin.css` provide account and access-request administration, access-code invites, and registered cart-user management.
- `cart-admin.js` manages admin-only shared-cart controls and the order email-draft activity log, including the admin access checks.

## Shared design and interaction styles

- `site-theme.css` defines the shared design tokens and base styles.
- `site-access.css` styles the access/verification screens.
- `ani.css`, `admin.css`, `account-admin.css`, `landing.css`, and `cart-groups.css` style their corresponding feature areas. `cart-groups.css` is intentionally a small override layer.

## Browser and server code groups

- `ani.js` and `electrical.js` each contain the page-specific tab controller, shared-cart client/RPC adapter, local fallback and sync, activity rendering, clear-cart behavior, email-draft handoff, and cart-panel interactions. Their cart implementations are parallel; keep shared behavior aligned when changing either.
- `admin.js` edits mechanical inventory; `electrical-inventory.js` defines and migrates electrical catalog state; `electrical-admin.html` loads the electrical admin page with its configuration and access gate.
- `supabase/functions/website-access-codes/index.ts` is the access-invite API: request parsing and response handling, code hashing/encryption, admin authorization, invite creation/listing, and redemption.
- `supabase/functions/send-auth-email/index.ts` handles Supabase Auth email hooks through Microsoft Graph: token retrieval/refresh, message construction and HTML escaping, and delivery.
- `supabase/functions/microsoft-mail-setup/index.ts` handles the admin's Microsoft Graph device authorization flow and persists its state through protected database operations.
- Each `supabase/functions/*/deno.json` configures the matching Deno function runtime. JSON configuration is kept comment-free so it remains valid JSON; its purpose is listed here.

## Database SQL and migrations

The SQL files are deployment scripts and schema history. Prefer applying ordered files in `supabase/migrations/` to an existing database; the root `supabase-*.sql` files are setup or focused repair scripts and can overlap with migration definitions. Review the target project and current schema before applying a script.

- `supabase/migrations/20261125113331_website_access_approval.sql`: access-request records, approval helpers, and approved-user gates for cart operations.
- `supabase/migrations/20261125125923_fix_clear_shared_cart_where_clause.sql`: corrected cart clear function.
- `supabase/migrations/20261125151441_microsoft_graph_email_state.sql`: private Microsoft Graph token state and management RPC.
- `supabase/migrations/20261126093132_website_access_codes.sql`: encrypted access invites and management/redeem RPCs.
- `supabase/migrations/20261126130000_protect_shared_cart_reads.sql`: approved-user checks on shared-cart reads.
- `supabase-setup.sql`: consolidated shared-cart tables, policies, functions, admin helpers, and order draft logging for initial setup.
- `supabase-admin-security.sql`: consolidated admin security and management functions, including profiles, display-name protection, logs, account management, and cart-user registry.
- `supabase-admin-management.sql`, `supabase-admin-account-management.sql`, and `supabase-admin-account-visibility.sql`: focused admin/account management variants that may overlap with the consolidated security script.
- `supabase-admin-order-log.sql`: focused order email-draft audit table and RPCs.
- `supabase-admin-visibility.sql`: safe “admin configured” status RPC for hiding admin UI from visitors.
- `supabase-cart-user-registry.sql`: visitor cart-name registry and admin management RPCs.
- `supabase-cart-browser-reset-public-clear.sql`: browser removal/reset and approved-user cart clearing.
- `supabase-fix-clear-changes.sql`: replacement clear-cart and activity-clear functions.
- `supabase-verified-cart-users.sql`: shared-cart approval/verification enforcement and browser-to-user association.

## Database setup reference

`SUPABASE_SETUP.md` is the operational setup and troubleshooting guide for Supabase configuration, SQL deployment, functions, and secrets. It complements the code map; consult it before changing the hosted backend.

## Source coverage

Every maintained project file is covered above or has a file-purpose comment at its top. The three `deno.json` files are the exception to inline comments because they are machine-readable JSON; their role is documented in the Deno section. `README.md` is this map, and `SUPABASE_SETUP.md` is the backend operations guide.
