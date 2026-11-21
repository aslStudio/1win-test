// Explicit layout anchors; adjust selectors after reviewing the approved source.
export const mappings = {
  contentRoot: 'main',
  header: 'header',
  footer: 'footer',
  navigation: 'nav',
  generatedArticleAttribute: 'data-docx-content'
} as const;

export const imageAlts: Record<string, string[]> = {
  home: [
    'Screenshot of the 1Win home page',
    'Screenshot of the 1Win casino game catalogue',
    'Three 1Win promotion graphics',
    'Screenshot of the 1Win registration form with Tanzanian shilling selected',
    'Screenshot of the 1Win Drops & Wins game list'
  ],
  bet: [
    'Screenshot of the 1Win sports betting page',
    'Screenshot of virtual sports games on 1Win',
    'Screenshot of the 1Win esports betting page',
    'Screenshot of the 1Win live score page'
  ],
  casino: [
    'Screenshot of the 1Win casino page',
    'Screenshot of slots and live casino games on 1Win',
    'Screenshot of the 1Win login form',
    'Screenshot of live games on 1Win'
  ]
};
