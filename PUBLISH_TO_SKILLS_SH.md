# Publish to skills.sh

Replace `YOUR_GITHUB_USERNAME` below.

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/immersive-translate-learning.git
git push -u origin main
```

Then seed the skills.sh catalogue with a real install:

```bash
npx skills add YOUR_GITHUB_USERNAME/immersive-translate-learning --global --yes
```

Later updates:

```bash
git add .
git commit -m "Update skill and extension"
git push
npx skills update
```

The browser extension itself should be attached separately as a GitHub Release asset.
