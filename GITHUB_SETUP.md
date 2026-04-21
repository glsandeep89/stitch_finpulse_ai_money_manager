# GitHub setup

If Git is not initialized yet, run from the repository root:

```bash
git init
git add .
git commit -m "Initial FinPulse: API, SPA, Supabase migrations, Docker"
git branch -M main
```

Create a new repository named `finpulse` on GitHub (empty, no README), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/finpulse.git
git push -u origin main
```

For HTTPS with a personal access token, use your token as the password when prompted, or:

```bash
git remote add origin https://YOUR_TOKEN@github.com/YOUR_USERNAME/finpulse.git
```

Prefer SSH or a credential manager instead of embedding tokens in the URL.

After the first push, continue pushing as you change code:

```bash
git add .
git commit -m "Describe your change"
git push
```
