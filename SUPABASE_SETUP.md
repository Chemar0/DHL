# Configure the shared cart and administrator

The mechanical and electrical pages share one cart through Supabase.

## Connect the project

1. For a new project, run `supabase-setup.sql` in the SQL editor. For an existing project with the earlier admin and username migrations already installed, run `supabase-verified-cart-users.sql`. Otherwise run the missing admin migrations first, followed by `supabase-cart-user-registry.sql`, `supabase-cart-browser-reset-public-clear.sql`, and `supabase-verified-cart-users.sql` in that order.
2. In the project's API settings, copy the Project URL and publishable key.
3. Put those values in `supabase-config.js`. The publishable key is designed for browser use. Never put a service-role key in this repository.

## Set up the sole administrator

Visitors enter their email on the cart page and open the verification link on the same device. Supabase Auth creates or signs in the account; the shared cart remains locked until Supabase reports that email as confirmed. Verified users can read and change the shared cart, clear it after the on-page confirmation, and request an order email. Anonymous and unverified sessions cannot read or change shared cart data.

Visitor accounts do not receive administrator access. Admin privileges remain limited to the accounts in `private.cart_admins`; adding an admin still requires the owner to select an already verified email.

Add the initial administrator from Supabase Dashboard → Authentication → Users, using an inbox you control, then verify the account. The admin sign-in uses a magic link to an account already present in Supabase Auth.

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

After sign-in, the database checks the authenticated user ID against `private.cart_admins`. The browser label and local storage cannot grant administrator access. Allowlisted admins can view recent cart changes, change the administrator display name, clear recent changes, review order email history, delete mistaken order entries, and see registered user emails. Only the owner can grant admin access and permanently delete other accounts. The owner account cannot be deleted from the site. Clearing recent changes leaves a server-authenticated entry showing who cleared them.

When an administrator is configured, the cart hides the administrator panel and sign-in entry from ordinary visitors. A browser that has previously signed in as an admin remembers the sign-in entry locally. On a new browser, an admin can open `mechanical.html?cartAdmin=signin` (or `electrical.html?cartAdmin=signin`) to sign in. This URL only opens the sign-in form; database checks still prevent non-admin accounts from using admin actions. The public setup check returns only whether an administrator exists; it does not expose account emails or IDs.

To add another administrator, first register that person through the cart or create their account in Supabase Auth and verify their email. Then sign in as the owner, open the cart, and use **Registered users** to grant admin access to their verified email. Admin accounts added this way cannot grant admin access to others. The owner can delete accounts from the same list. Deleted or unverified accounts cannot access shared cart data.

After email verification, each browser enters a display name for cart attribution. The name is a self-entered label linked to the verified Auth account, not a legal identity or a MAC-address identity. Admins can see registered email accounts under **Registered users** and each browser name beside its verified email under **Cart usernames**. If the owner removes a browser, it must enter a name again before it can reappear.

Recent cart changes and order email history are available only to signed-in administrators. The order history records each confirmed request to open an email draft and its item details. Because the site opens the visitor's email app, the log cannot confirm whether the draft was actually sent. Admins can delete mistaken entries. Any verified user can clear the shared cart after confirming; the activity log records who did it. If Supabase settings or email verification are unavailable, the shared cart stays locked.
