# Configure the shared cart and administrator

The mechanical and electrical pages share one cart through Supabase.

## Connect the project

1. For a new project, run `supabase-setup.sql` in the SQL editor. For the existing project, run `supabase-admin-security.sql` to add the admin protections without deleting the cart or its activity. If that security migration is already installed, run `supabase-admin-visibility.sql` to let the pages hide the admin panel from visitors.
2. In the project's API settings, copy the Project URL and publishable key.
3. Put those values in `supabase-config.js`. The publishable key is designed for browser use. Never put a service-role key in this repository.

## Set up the sole administrator

The site does not create Auth accounts. Add the administrator from Supabase Dashboard → Authentication → Users, using an inbox you control, then verify the account. The browser sign-in sends a magic link only to an account that already exists in Supabase Auth.

In Authentication → URL Configuration, allow these redirect URLs (or the equivalent URLs for your deployed domain):

- `https://chemar0.github.io/DHL/mechanical.html`
- `https://chemar0.github.io/DHL/electrical.html`

After the email is verified, replace the placeholder below with that address and run this once in the SQL editor. It adds only the matching verified Auth user ID to the private admin allowlist and raises an error if no verified account matches.

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

    insert into private.cart_admins (user_id)
    values (v_admin_id)
    on conflict (user_id) do nothing;
end;
$$;
```

After sign-in, the database checks the authenticated user ID against `private.cart_admins`. The browser label and local storage cannot grant administrator access. Only the allowlisted account can change the administrator display name, clear recent changes, or clear the shared cart. Clearing recent changes leaves a server-authenticated entry showing who cleared them.

When an administrator is configured, the cart hides the full administrator panel from visitors. It shows a small “Administrator sign in” entry so the allowlisted account can sign in again on another browser. The public setup check returns only whether an administrator exists; it does not expose the account email or ID.

Other visitors still enter a display name for cart attribution. That name is self-entered and stored in that browser profile; it is not a verified identity or a MAC-address identity. Visitors cannot rename it through the site after the initial entry, and the database blocks use of the administrator's reserved display name in cart activity.

The cart contents and recent activity are readable by anyone who can access the site. Avoid putting sensitive information there. If Supabase settings are missing, the page saves a separate local cart in that browser instead of using the shared cart.
