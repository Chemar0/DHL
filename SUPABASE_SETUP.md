# Configure the shared cart and administrator

The mechanical and electrical pages share one cart through Supabase.

## Connect the project

1. For a new project, run `supabase-setup.sql` in the SQL editor. For the existing project, run `supabase-admin-security.sql` to add admin protections without deleting cart data, then run `supabase-admin-visibility.sql`, `supabase-admin-management.sql`, `supabase-admin-order-log.sql`, and `supabase-admin-account-management.sql`. If the earlier security migrations are already installed, run the account management migration (and any other migration that has not yet been applied).
2. In the project's API settings, copy the Project URL and publishable key.
3. Put those values in `supabase-config.js`. The publishable key is designed for browser use. Never put a service-role key in this repository.

## Set up the sole administrator

The site does not create Auth accounts. Add the administrator from Supabase Dashboard → Authentication → Users, using an inbox you control, then verify the account. The browser sign-in sends a magic link only to an account that already exists in Supabase Auth.

In Authentication → URL Configuration, allow these redirect URLs (or the equivalent URLs for your deployed domain):

- `https://chemar0.github.io/DHL/mechanical.html`
- `https://chemar0.github.io/DHL/electrical.html`

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

After sign-in, the database checks the authenticated user ID against `private.cart_admins`. The browser label and local storage cannot grant administrator access. Allowlisted admins can view recent cart changes, change the administrator display name, clear recent changes, review order email history, delete mistaken order entries, and clear the shared cart. Only the owner can grant admin access to verified Supabase Auth accounts, see the full Auth account list, and permanently delete other accounts. The owner account cannot be deleted from the site; the sign-in form never creates accounts. Clearing recent changes leaves a server-authenticated entry showing who cleared them.

When an administrator is configured, the cart hides the administrator panel and sign-in entry from ordinary visitors. A browser that has previously signed in as an admin remembers the sign-in entry locally. On a new browser, an admin can open `mechanical.html?cartAdmin=signin` (or `electrical.html?cartAdmin=signin`) to sign in. This URL only opens the sign-in form; database checks still prevent non-admin accounts from using admin actions. The public setup check returns only whether an administrator exists; it does not expose account emails or IDs.

To add another administrator, first invite or create that person in Supabase Auth and verify their email. Then sign in as the owner, open the cart, and use **Manage accounts** to add their verified email. Admin accounts added this way cannot grant admin access to others. The owner can remove an account from the same list. Deleting an Auth account does not ban someone from using the public cart anonymously, and any already issued access token remains valid until it expires.

Other visitors still enter a display name for cart attribution. That name is self-entered and stored in that browser profile; it is not a verified identity or a MAC-address identity. Visitors cannot rename it through the site after the initial entry, and the database blocks use of the administrator's reserved display name in cart activity.

Recent cart changes and order email history are available only to signed-in administrators; cart contents remain shared with site visitors. The order history records each confirmed request to open an email draft and its item details. Because the site opens the visitor's email app, the log cannot confirm whether the draft was actually sent. Admins can delete mistaken entries. Avoid putting sensitive information in the shared cart. If Supabase settings are missing, the page saves a separate local cart in that browser instead of using the shared cart, and order emails are unavailable because they cannot be logged centrally.
