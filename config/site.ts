export const site = {
  sourceUrl: process.env.SOURCE_URL || 'https://www.maniacba.com.ar/',
  sourceHost: process.env.SOURCE_HOST || 'www.maniacba.com.ar',
  contentOrigin: 'https://1-win.co.tz',
  canonicalBase: 'https://aslstudio.github.io/1win-test',
  robotsDirective: 'noindex',
  locale: 'en-TZ',
  promoCode: 'GOL5',
  pages: [
    { key: 'home', route: '/', docx: 'input/content/home/1Win Главная.docx' },
    { key: 'bet', route: '/bet', docx: 'input/content/bet/1Win Bet.docx' },
    { key: 'casino', route: '/casino', docx: 'input/content/casino/1Win Casino.docx' }
  ]
} as const;
