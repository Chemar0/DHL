# Configure the shared cart

The mechanical and electrical pages use one shared list for everyone who opens the site. The site needs a Supabase project to sync it across devices.

1. Create a Supabase project.
2. Open the project SQL editor and run supabase-setup.sql. Run the updated script again when you add the remembered-name and cart-history changes.
3. In the project API settings, copy the Project URL and the publishable key.
4. Put those two values in supabase-config.js:
   window.SUPABASE_CONFIG = {
       url: 'https://YOUR-PROJECT.supabase.co',
       publishableKey: 'YOUR-PUBLISHABLE-KEY'
   };
5. Commit the real URL and anon/publishable key to the site's deployed branch. These values are designed to be public in browser code. Never use a service-role key.

Each browser asks for a display name once and remembers it in that browser's local storage. The shared cart shows who first added each item, who last changed it, and a recent activity list. The name is self-entered, not verified; anyone using that browser can change or use the saved name. Private browsing, another browser profile, or cleared site data may require entering it again.

The shared cart and its activity are readable by anyone who can access the site. Do not put private or sensitive information in it. If the Supabase settings are missing, the cart and its activity are saved only in that browser. The page checks for shared changes every four seconds while visible.
