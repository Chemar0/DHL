# Configure the shared cart and administrator

The mechanical and electrical pages share one cart through Supabase.

## Connect the project

1. For a new project, run `supabase-setup.sql` first. Then apply every file in `supabase/migrations/` in filename order. For an existing project, apply any missing migrations in that same order. These migrations add the website approval gate, the current clear-cart function, administrator-issued access numbers, and approved-user checks for reading cart contents and activity. Do not rerun the older one-off SQL snippets as a substitute for migrations.
2. In the project's API settings, copy the Project URL and publishable key.
3. Put those values in `supabase-config.js`. The publishable key is designed for browser use. Never put a service-role key in this repository.

## Authentication email delivery and visitor access numbers

Visitors enter an eight-digit access number with their email. An administrator creates it under **Admin features → Manage accounts → Issue an access number**. Supabase Auth generates the number without sending an email. The administrator relays it, and it remains visible on the account management page until it is used or revoked. Making a replacement invalidates the previous number. The number expires according to the Supabase Auth OTP expiration setting and can be tried five times before it must be replaced.

This visitor access flow sends no email and does not use the email sending quota. Administrator sign-in still uses a Supabase email link and remains subject to the project's existing rate limit.

Deploy `supabase/functions/website-access-codes` with JWT verification disabled. The function requires an administrator session for issuing, listing, or revoking numbers, and validates the number with Supabase Auth before signing a visitor in. It uses the built-in `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` Edge Function secrets. Never expose either key in website files.

The default Supabase sender permits 2 emails/hour and only sends to project team addresses. With custom SMTP or an Auth Send Email Hook, that rate is configurable. The separate per-address 60-second cooldown applies to email requests. The access-number flow does not change the project's email limit.

## Set up the sole administrator

Visitors need a number created by an administrator. Supabase Auth verifies it without sending an email and creates or signs in the account. Redeeming the number approves the visitor for the website. The older pending-request review remains available for existing accounts. Anonymous, unverified, and unapproved sessions cannot read or change shared cart data.

Visitor accounts do not receive administrator access. Admin privileges remain limited to the accounts in `private.cart_admins`; adding an admin still requires the owner to select an already verified email.

Add the initial administrator from Supabase Dashboard → Authentication → Users, using an inbox you control, then verify the account. The admin sign-in uses a magic link to an account already present in Supabase Auth.

In Authentication → URL Configuration, allow these redirect URLs (or the equivalent URLs for your deployed domain):

- `https://chemar0.github.io/DHL/index.html`
- `https://chemar0.github.io/DHL/mechanical.html`
- `https://chemar0.github.io/DHL/electrical.html`
- `https://chemar0.github.io/DHL/admin.html`
- `https://chemar0.github.io/DHL/electrical-admin.html`

After the email is verified, replace the placeholder below with that address and run this once in the SQL editor. It adds only the matching verified Auth user ID as the owner and raises an error if no verified account matches.

```sql
do $$
declare
    v_admin_id uuid;
begin
    select id
    into v_admin_id
    from auth.users
    where lower(email) = lower('REPLACE-WITH-ADMIN-EMAIL@example.com')
      and email_confirmed_at is not null;

    if v_admin_id is null then
        raise exception 'No verified Supabase Auth user found for that email.';
    end if;

    insert into private.cart_admins (user_id, is_owner)
    values (v_admin_id, true)
    on conflict (user_id) do nothing;
end;
$$;
```

After sign-in, the database checks the authenticated user ID against `private.cart_admins`. The browser label and local storage cannot grant administrator access. The **Manage accounts** page groups the administrator display name, website access requests and numbers, registered accounts, cart usernames, and sign-out. Recent cart changes and order email history stay under **Admin features**. Only the owner can grant admin access and permanently delete other accounts. The owner account cannot be deleted from the site. Clearing recent changes leaves a server-authenticated entry showing who cleared them.

When an administrator is configured, the cart hides the administrator panel and sign-in entry from ordinary visitors. A browser that has previously signed in as an admin remembers the sign-in entry locally. On a new browser, an admin can open `mechanical.html?cartAdmin=signin` (or `electrical.html?cartAdmin=signin`) to sign in. This URL only opens the sign-in form; database checks still prevent non-admin accounts from using admin actions. The public setup check returns only whether an administrator exists; it does not expose account emails or IDs.

To add another administrator, first register that person through the cart or create their account in Supabase Auth and verify their email. Then sign in as the owner, open **Admin features → Manage accounts**, and grant admin access to their verified email under **Registered accounts**. Admin accounts added this way cannot grant admin access to others. The owner can delete accounts from the same list. Deleted or unverified accounts cannot access shared cart data.

After the request is approved, each browser enters a display name for cart attribution. The name is a self-entered label linked to the verified Auth account, not a legal identity or a MAC-address identity. Admins can see registered email accounts and each browser name beside its verified email on **Manage accounts** under **Registered accounts** and **Cart usernames**. If the owner removes a browser, it must enter a name again before it can reappear.

The Supabase cart read and write RPCs enforce approval server-side; a signed-in but unapproved account cannot read the shared cart or recent activity. The mechanical and electrical item catalog defaults are still shipped as static JavaScript with this GitHub Pages site, so those item names can be fetched by anyone who knows the public site URL. Keep confidential product or supplier information out of those static files; hiding the interface does not make static assets private.

Recent cart changes and order email history are available only to signed-in administrators. The order history records each confirmed request to open an email draft and its item details. Because the site opens the visitor's email app, the log cannot confirm whether the draft was actually sent. Admins can delete mistaken entries. Any approved user can clear the shared cart after confirming; the activity log records who did it. If Supabase settings, email verification, or approval checks are unavailable, shared-cart access stays locked.
