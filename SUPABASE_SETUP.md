# Configure the shared electrical cart

The electrical cart is one shared list for everyone who opens the site. The site needs a Supabase project to sync it across devices.

1. Create a Supabase project.
2. Open the project SQL editor and run `supabase-setup.sql`.
3. In the project API settings, copy the Project URL and the publishable key.
4. Put those two values in `supabase-config.js`:
   ```js
   window.SUPABASE_CONFIG = {
       url: 'https://YOUR-PROJECT.supabase.co',
       publishableKey: 'YOUR-PUBLISHABLE-KEY'
   };
   ```
5. Commit the real URL and anon/publishable key to the site's deployed branch. These values are designed to be public in browser code. Never use a service-role key.

Until configured, the cart continues to work locally in each browser. After configuration, additions, quantity changes, and clearing the cart are shared. The page checks for changes every four seconds while visible.

Because this is a public shared cart with no sign-in, anyone who can access the website can see, change, or clear its contents. Do not put private or sensitive information in it.
