# Parts List Project Guide

This project is the mechanical and electrical parts website. It uses Supabase (an online database and sign-in service) for the shared cart and account checks. The notes inside the code say what each main group does in plain language.

## Opening the site

- `index.html`, `landing.css`, and `landing.js` make the home page and its two list buttons.
- `site-access.js` and `site-access.css` check whether someone may enter and show the waiting or approved screens.
- `supabase-config.js` has the public address and browser key for Supabase. Never put a private admin key in this file.
- `logo.svg` is the site logo.

## Parts lists and carts

- `mechanical.html`, `inventory.js`, `ani.js`, and `ani.css` make the mechanical list. The HTML shows the page, inventory.js holds the default items, ani.js runs the buttons and cart, and ani.css sets their appearance.
- `electrical.html`, `electrical-inventory.js`, `electrical.js`, and `cart-groups.css` do the same for the electrical list.
- `cart-groups.js` sorts cart items into mechanical or electrical groups.
- `cart-user.js` remembers the name shown beside cart changes and identifies the browser. The name is only a label; it does not prove who the person is.
- `cart-admin.js` runs the admin controls in the cart, checks admin access, and shows the order email history.

## Editing and account pages

- `admin.html`, `admin.css`, and `admin.js` let an admin edit the mechanical list.
- `electrical-admin.html` opens the electrical editor. It uses `admin.css`, `admin.js`, and `electrical-inventory.js`.
- `accounts-admin.html`, `account-admin.css`, and `account-admin.js` manage access requests, access numbers, accounts, and browser names.

## Shared look

- `site-theme.css` sets the common colors and text styles.
- `site-access.css` styles the access screens.
- Each other CSS file styles the page or feature named in its file purpose note. CSS means the rules that set how a page looks.

## Server-side code

The files under `supabase/functions/` run on the Supabase server:

- `website-access-codes/index.ts` creates and checks access numbers.
- `send-auth-email/index.ts` sends sign-in emails through Microsoft.
- `microsoft-mail-setup/index.ts` lets an admin connect Microsoft email.
- Each nearby `deno.json` tells Deno (the program that runs these server files) how to start that function. JSON files do not allow comments, so their purpose is described here.

## Database files

SQL files set up the database or change how it works. RPC means a database function the website can call. Migrations are numbered database updates that are applied in order.

- `supabase/migrations/20261125113331_website_access_approval.sql` saves access requests and checks approval.
- `supabase/migrations/20261125125923_fix_clear_shared_cart_where_clause.sql` fixes the cart clear action.
- `supabase/migrations/20261125151441_microsoft_graph_email_state.sql` saves Microsoft email sign-in details privately.
- `supabase/migrations/20261126093132_website_access_codes.sql` saves and checks website access numbers.
- `supabase/migrations/20261126130000_protect_shared_cart_reads.sql` checks approval before showing cart data.
- `supabase-setup.sql` creates the shared cart, change history, admin tools, and order email history.
- `supabase-admin-security.sql` sets rules for admin accounts, names, cart clearing, and history.
- `supabase-admin-management.sql`, `supabase-admin-account-management.sql`, and `supabase-admin-account-visibility.sql` manage admin accounts and who can view them.
- `supabase-admin-order-log.sql` saves and shows the admin-only order email history.
- `supabase-admin-visibility.sql` lets the page check whether admin tools exist without showing admin names or email addresses.
- `supabase-cart-user-registry.sql` saves browser names and lets admins review or remove them.
- `supabase-cart-browser-reset-public-clear.sql` lets admins remove a browser and approved users clear the cart.
- `supabase-fix-clear-changes.sql` updates the cart clearing actions and keeps a record of them.
- `supabase-verified-cart-users.sql` checks that an account is confirmed and approved before it can use the shared cart.

Some SQL files cover the same parts of the database. `SUPABASE_SETUP.md` explains how the database and server functions are set up. Read it before changing Supabase settings.
