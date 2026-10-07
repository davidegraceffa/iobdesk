export type TechCategory =
  'frontend' | 'backend' | 'languages' | 'database' | 'cloudDevops' | 'testing' | 'mobile' | 'other';

export const TECH_CATEGORIES: TechCategory[] = [
  'frontend',
  'backend',
  'languages',
  'database',
  'cloudDevops',
  'testing',
  'mobile',
  'other',
];

export interface TechEntry {
  /** nome canonico mostrato nella UI */
  name: string;
  category: TechCategory;
  /** alias riconosciuti (case-insensitive, parola intera). Il nome canonico è sempre incluso. */
  aliases?: string[];
  /**
   * Per nomi ambigui (Go, Swift, Rust, Express…): pattern esplicito usato nel testo libero
   * al posto degli alias. Nei tag della fonte gli alias valgono sempre.
   */
  textPattern?: RegExp;
}

/** Contesti tecnici in cui una parola comune è quasi certamente una tecnologia. */
const DEV_CTX =
  '(?:[Dd]evelopers?|[Ee]ngineer(?:s|ing)?|[Pp]rogrammers?|[Bb]ack-?end|[Ss]ervices?|[Mm]icroservices?|[Cc]odebase|[Cc]ode|[Ss]tack|[Ee]xperience|[Pp]roficiency|[Kk]nowledge|SDK|APIs?)';

export const TECH_DICTIONARY: TechEntry[] = [
  // ── Frontend ───────────────────────────────────────────────
  {
    name: 'React',
    category: 'frontend',
    aliases: ['react.js', 'reactjs'],
    textPattern: /(?<![\w-])(?:React(?:\.?js)?|react\.?js|REACT)(?![\w-]|\s+Native)/,
  },
  {
    name: 'Next.js',
    category: 'frontend',
    aliases: ['nextjs', 'next js'],
    textPattern: /(?<![\w-])next\.?\s?js(?![\w-])/i,
  },
  { name: 'Vue', category: 'frontend', aliases: ['vue.js', 'vuejs', 'vue 3', 'vue3'] },
  { name: 'Nuxt', category: 'frontend', aliases: ['nuxt.js', 'nuxtjs'] },
  { name: 'Angular', category: 'frontend', aliases: ['angularjs', 'angular.js'] },
  { name: 'Svelte', category: 'frontend', aliases: ['sveltekit'] },
  { name: 'Remix', category: 'frontend', textPattern: /(?<![\w-])Remix(?:\.run)?(?![\w-])/ },
  { name: 'Astro', category: 'frontend', textPattern: /(?<![\w-])Astro(?:\.js)?(?![\w-])/ },
  { name: 'Redux', category: 'frontend', aliases: ['redux toolkit'] },
  { name: 'Tailwind CSS', category: 'frontend', aliases: ['tailwind', 'tailwindcss'] },
  { name: 'HTML', category: 'frontend', aliases: ['html5'] },
  { name: 'CSS', category: 'frontend', aliases: ['css3'] },
  { name: 'Sass', category: 'frontend', aliases: ['scss'] },
  { name: 'Webpack', category: 'frontend' },
  { name: 'Vite', category: 'frontend', textPattern: /(?<![\w-])Vite(?:\.?js)?(?![\w-])/ },
  { name: 'Storybook', category: 'frontend' },
  { name: 'jQuery', category: 'frontend' },
  { name: 'TanStack Query', category: 'frontend', aliases: ['react query', 'react-query'] },
  { name: 'Material UI', category: 'frontend', aliases: ['mui', 'material-ui'] },
  { name: 'shadcn/ui', category: 'frontend', aliases: ['shadcn'] },
  { name: 'Three.js', category: 'frontend', aliases: ['threejs', 'webgl'] },
  { name: 'Electron', category: 'frontend', textPattern: /(?<![\w-])Electron(?:\.?js)?(?![\w-])/ },

  // ── Backend ────────────────────────────────────────────────
  {
    name: 'Node.js',
    category: 'backend',
    aliases: ['node', 'nodejs', 'node js'],
    textPattern: /(?<![\w-])[Nn]ode\.?\s?[Jj][Ss](?![\w-])|(?<![\w-])Node(?![\w-]|\s+pool)/,
  },
  {
    name: 'NestJS',
    category: 'backend',
    aliases: ['nest.js', 'nest js', 'nest'],
    textPattern: /(?<![\w-])nest\.?\s?js(?![\w-])/i,
  },
  {
    name: 'Express',
    category: 'backend',
    aliases: ['express.js', 'expressjs'],
    textPattern:
      /(?<![\w-])[Ee]xpress\.?[Jj][Ss](?![\w-])|(?<![\w-])Express(?=\s*[,/)]|\s+(?:and|or|server|framework|middleware|app)\b)/,
  },
  { name: 'Fastify', category: 'backend' },
  { name: 'Deno', category: 'backend', textPattern: /(?<![\w-])Deno(?![\w-])/ },
  { name: 'Bun', category: 'backend', textPattern: /(?<![\w-])Bun(?:\.js|\.sh)?(?=\s*[,/)]|\s+(?:and|or|runtime)\b)/ },
  { name: 'Django', category: 'backend' },
  { name: 'Flask', category: 'backend', textPattern: /(?<![\w-])Flask(?![\w-])/ },
  { name: 'FastAPI', category: 'backend' },
  {
    name: 'Ruby on Rails',
    category: 'backend',
    aliases: ['rails', 'ror'],
    textPattern: /(?<![\w-])(?:Ruby\s+on\s+Rails|Rails|RoR)(?![\w-])/,
  },
  { name: 'Laravel', category: 'backend' },
  { name: 'Symfony', category: 'backend' },
  {
    name: 'Spring',
    category: 'backend',
    aliases: ['spring boot', 'springboot'],
    textPattern:
      /(?<![\w-])Spring(?:\s?Boot|\s+(?:Framework|MVC|Cloud|Security|Data))(?![\w-])|(?<![\w-])Spring(?=\s*[,/)])/,
  },
  {
    name: '.NET',
    category: 'backend',
    aliases: ['dotnet', 'asp.net', '.net core', 'asp.net core'],
    textPattern: /(?<![\w])(?:ASP)?\.NET(?:\s?Core)?(?![\w])|(?<![\w-])dotnet(?![\w-])/i,
  },
  {
    name: 'Phoenix',
    category: 'backend',
    textPattern: /(?<![\w-])Phoenix\s+(?:framework|LiveView)|Elixir\s*\/\s*Phoenix/i,
  },
  { name: 'Gin', category: 'backend', textPattern: /(?<![\w-])Gin\s+(?:framework|Gonic)/i },

  // ── Linguaggi ──────────────────────────────────────────────
  {
    name: 'TypeScript',
    category: 'languages',
    aliases: ['ts'],
    textPattern: /(?<![\w-])typescript(?![\w-])|(?<![\w-])TS(?=\s*[/,]\s*(?:JS|JavaScript))/i,
  },
  {
    name: 'JavaScript',
    category: 'languages',
    aliases: ['js', 'ecmascript', 'es6'],
    textPattern: /(?<![\w-])(?:javascript|ecmascript|es6)(?![\w-])|(?<=TS\s?\/\s?)JS(?![\w-])/i,
  },
  { name: 'Python', category: 'languages' },
  { name: 'Java', category: 'languages', textPattern: /(?<![\w-])Java(?![\w-]|Script)/ },
  { name: 'Kotlin', category: 'languages' },
  {
    name: 'Go',
    category: 'languages',
    aliases: ['golang'],
    textPattern: new RegExp(
      `(?<![\\w-])[Gg]olang(?![\\w-])|(?<![\\w-])Go(?=\\s*[,/)]\\s*[A-Z]|\\s+${DEV_CTX}\\b|\\s*\\(Golang\\))|(?<=\\b(?:in|with|using|and|or|,)\\s)Go(?=\\s*(?:[,/).;]|and\\b|or\\b|$))`,
    ),
  },
  { name: 'Rust', category: 'languages', textPattern: /(?<![\w-])Rust(?![\w-])/ },
  { name: 'Ruby', category: 'languages', textPattern: /(?<![\w-])Ruby(?![\w-])/ },
  { name: 'PHP', category: 'languages' },
  {
    name: 'C#',
    category: 'languages',
    aliases: ['csharp', 'c sharp'],
    textPattern: /(?<![\w-])C#|(?<![\w-])c\s?sharp(?![\w-])/i,
  },
  { name: 'C++', category: 'languages', aliases: ['cpp'], textPattern: /(?<![\w-])C\+\+/ },
  { name: 'Scala', category: 'languages', textPattern: /(?<![\w-])Scala(?![\w-])/ },
  { name: 'Elixir', category: 'languages' },
  { name: 'Swift', category: 'languages', textPattern: /(?<![\w-])Swift(?:UI)?(?![\w-])/ },
  { name: 'Dart', category: 'languages', textPattern: /(?<![\w-])Dart(?![\w-])/ },
  { name: 'SQL', category: 'languages' },
  {
    name: 'Bash',
    category: 'languages',
    aliases: ['shell scripting'],
    textPattern: /(?<![\w-])Bash(?![\w-])|shell\s+scripting/,
  },
  { name: 'Solidity', category: 'languages' },

  // ── Database ───────────────────────────────────────────────
  { name: 'PostgreSQL', category: 'database', aliases: ['postgres', 'postgresql', 'psql', 'pgsql'] },
  { name: 'MySQL', category: 'database', aliases: ['mariadb'] },
  { name: 'MongoDB', category: 'database', aliases: ['mongo'] },
  { name: 'Redis', category: 'database' },
  { name: 'Elasticsearch', category: 'database', aliases: ['elastic search', 'opensearch'] },
  { name: 'DynamoDB', category: 'database' },
  { name: 'SQLite', category: 'database' },
  { name: 'SQL Server', category: 'database', aliases: ['mssql', 'ms sql'] },
  { name: 'Oracle', category: 'database', textPattern: /(?<![\w-])Oracle\s+(?:DB|Database|SQL)|PL\/SQL/i },
  { name: 'Cassandra', category: 'database' },
  { name: 'ClickHouse', category: 'database' },
  { name: 'Snowflake', category: 'database', textPattern: /(?<![\w-])Snowflake(?![\w-])/ },
  { name: 'BigQuery', category: 'database' },
  { name: 'Supabase', category: 'database' },
  { name: 'Firebase', category: 'database', aliases: ['firestore'] },
  { name: 'Prisma', category: 'database', textPattern: /(?<![\w-])Prisma(?![\w-])/ },
  { name: 'TypeORM', category: 'database' },
  { name: 'Drizzle', category: 'database', textPattern: /(?<![\w-])Drizzle(?:\s?ORM)?(?![\w-])/ },
  { name: 'Sequelize', category: 'database' },

  // ── Cloud / DevOps ─────────────────────────────────────────
  {
    name: 'AWS',
    category: 'cloudDevops',
    aliases: ['amazon web services'],
    textPattern: /(?<![\w-])AWS(?![\w-])|amazon\s+web\s+services/i,
  },
  { name: 'GCP', category: 'cloudDevops', aliases: ['google cloud', 'google cloud platform'] },
  { name: 'Azure', category: 'cloudDevops' },
  { name: 'Docker', category: 'cloudDevops' },
  { name: 'Kubernetes', category: 'cloudDevops', aliases: ['k8s'] },
  { name: 'Terraform', category: 'cloudDevops' },
  { name: 'Ansible', category: 'cloudDevops' },
  {
    name: 'CI/CD',
    category: 'cloudDevops',
    aliases: ['ci cd', 'cicd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  },
  { name: 'GitHub Actions', category: 'cloudDevops' },
  { name: 'GitLab CI', category: 'cloudDevops', aliases: ['gitlab-ci'] },
  { name: 'Jenkins', category: 'cloudDevops' },
  { name: 'Linux', category: 'cloudDevops' },
  { name: 'Nginx', category: 'cloudDevops' },
  {
    name: 'Serverless',
    category: 'cloudDevops',
    aliases: ['aws lambda', 'lambda functions'],
    textPattern: /(?<![\w-])serverless(?![\w-])|AWS\s+Lambda|Lambda\s+functions/i,
  },
  { name: 'Vercel', category: 'cloudDevops' },
  { name: 'Cloudflare', category: 'cloudDevops', aliases: ['cloudflare workers'] },
  { name: 'Datadog', category: 'cloudDevops' },
  { name: 'Prometheus', category: 'cloudDevops' },
  { name: 'Grafana', category: 'cloudDevops' },
  { name: 'Helm', category: 'cloudDevops', textPattern: /(?<![\w-])Helm(?:\s+charts?)?(?![\w-])/ },

  // ── Testing ────────────────────────────────────────────────
  { name: 'Jest', category: 'testing', textPattern: /(?<![\w-])Jest(?![\w-])/ },
  { name: 'Vitest', category: 'testing' },
  { name: 'Playwright', category: 'testing' },
  { name: 'Cypress', category: 'testing', textPattern: /(?<![\w-])Cypress(?![\w-])/ },
  { name: 'Selenium', category: 'testing' },
  {
    name: 'Testing Library',
    category: 'testing',
    aliases: ['react testing library', 'rtl'],
    textPattern: /(?:react\s+)?testing\s+library/i,
  },
  { name: 'Mocha', category: 'testing', textPattern: /(?<![\w-])Mocha(?![\w-])/ },
  { name: 'Pytest', category: 'testing' },
  { name: 'JUnit', category: 'testing' },
  { name: 'TDD', category: 'testing', aliases: ['test-driven development', 'test driven development'] },

  // ── Mobile ─────────────────────────────────────────────────
  { name: 'React Native', category: 'mobile', aliases: ['react-native'] },
  { name: 'Flutter', category: 'mobile' },
  { name: 'iOS', category: 'mobile', textPattern: /(?<![\w-])iOS(?![\w-])/ },
  { name: 'Android', category: 'mobile' },
  { name: 'Expo', category: 'mobile', textPattern: /(?<![\w-])Expo(?![\w-])/ },
  { name: 'Ionic', category: 'mobile', textPattern: /(?<![\w-])Ionic(?![\w-])/ },

  // ── Altro ──────────────────────────────────────────────────
  { name: 'GraphQL', category: 'other', aliases: ['apollo graphql'] },
  {
    name: 'REST',
    category: 'other',
    aliases: ['rest api', 'rest apis', 'restful'],
    textPattern: /(?<![\w-])REST(?:ful)?(?:\s+APIs?)?(?![\w-])|(?<![\w-])restful(?![\w-])/,
  },
  { name: 'tRPC', category: 'other' },
  { name: 'gRPC', category: 'other' },
  { name: 'WebSockets', category: 'other', aliases: ['websocket', 'socket.io'] },
  { name: 'Kafka', category: 'other', aliases: ['apache kafka'] },
  { name: 'RabbitMQ', category: 'other' },
  { name: 'Microservices', category: 'other', aliases: ['microservice', 'micro-services'] },
  { name: 'OpenAPI', category: 'other', aliases: ['swagger'] },
  { name: 'OAuth', category: 'other', aliases: ['oauth2', 'oauth 2.0', 'openid connect', 'oidc'] },
  { name: 'Stripe', category: 'other', textPattern: /(?<![\w-])Stripe(?![\w-])/ },
  { name: 'LLM', category: 'other', aliases: ['llms', 'large language models', 'openai api', 'langchain'] },
  {
    name: 'Machine Learning',
    category: 'other',
    aliases: ['ml'],
    textPattern: /[Mm]achine\s+[Ll]earning|(?<![\w-])ML(?![\w-])/,
  },
  { name: 'Git', category: 'other', textPattern: /(?<![\w-])[Gg]it(?![\w-]|Hub|Lab)/ },
  { name: 'Agile', category: 'other', aliases: ['scrum', 'kanban'] },
  { name: 'Figma', category: 'other' },
  { name: 'WordPress', category: 'other' },
  { name: 'Shopify', category: 'other' },
  { name: 'Web3', category: 'other', aliases: ['blockchain', 'smart contracts'] },
];
