/** Bilingual strings for DEMO_ENABLED seed (English + French boards). */

export const DEMO_BOARD_SETTING = {
  en: 'DEMO_BOARD_EN',
  fr: 'DEMO_BOARD_FR',
};

export const DEMO_BOARD_TITLE = {
  en: 'Demo Board',
  fr: 'Tableau démo',
};

export const DEMO_SPRINT = {
  name: { en: 'Sprint 1 - Demo Sprint', fr: 'Sprint 1 — Sprint démo' },
  description: {
    en: 'Complete initial project setup and core features',
    fr: 'Terminer la mise en place du projet et les fonctionnalités de base',
  },
};

export const DEMO_ADMIN_BIO = {
  en: 'Demo admin · Keeps the board humming. Happy to help with roles, settings, or “where did that task go?”',
  fr: 'Admin démo · Fait tourner le tableau. Rôles, réglages, ou « où est passée cette tâche ? »',
};

export const DEMO_USER_BIOS = {
  john: {
    en: 'Frontend lead · React & design systems. Coffee-powered. Ask me about accessibility or CSS that actually works.',
    fr: 'Lead front · React et design systems. Fonctionne au café. Accessibilité ou CSS qui marche vraiment : c’est moi.',
  },
  sarah: {
    en: 'Product & UX. I turn fuzzy ideas into clear tickets. Usually in standups with a notebook and too many stickies.',
    fr: 'Produit et UX. Je transforme les idées floues en tickets clairs. Souvent en standup, carnet et trop de post-its.',
  },
  mike: {
    en: 'Backend & APIs. PostgreSQL enthusiast. If it involves queues, auth, or “why is this slow?”, ping me.',
    fr: 'Backend et APIs. Fan de PostgreSQL. Files, auth, ou « pourquoi c’est lent ? » : pinguez-moi.',
  },
};

export const DEMO_TAGS = [
  { name: 'frontend', color: '#3B82F6' },
  { name: 'backend', color: '#10B981' },
  { name: 'database', color: '#8B5CF6' },
  { name: 'security', color: '#EF4444' },
  { name: 'documentation', color: '#F59E0B' },
  { name: 'testing', color: '#EC4899' },
];

/** Stable keys; dates/effort/column/assignee live in demoDataSeed.js TASK_META */
export const DEMO_TASK_COPY = {
  research_integrations: {
    en: { title: 'Research third-party integrations', description: 'Investigate available APIs and services for payment processing and analytics.' },
    fr: { title: 'Étudier les intégrations tierces', description: 'Recenser les APIs et services pour le paiement et l’analytics.' },
  },
  dark_mode_polish: {
    en: { title: 'Explore dark-mode polish', description: 'Audit contrast and charts in dark theme; list follow-ups for a future sprint.' },
    fr: { title: 'Peaufiner le mode sombre', description: 'Auditer le contraste et les graphiques en thème sombre ; lister les suites pour un sprint futur.' },
  },
  api_versioning: {
    en: { title: 'Document API versioning policy', description: 'Draft how we version public REST endpoints and communicate breaking changes.' },
    fr: { title: 'Documenter le versionnage de l’API', description: 'Rédiger comment versionner les endpoints REST publics et annoncer les breaking changes.' },
  },
  analytics_vendors: {
    en: { title: 'Evaluate analytics vendors', description: 'Compare product analytics options (privacy, cost, SDK size) before committing.' },
    fr: { title: 'Comparer les outils d’analytics', description: 'Comparer les options (confidentialité, coût, taille du SDK) avant de s’engager.' },
  },
  keyboard_shortcuts: {
    en: { title: 'Add keyboard shortcuts help', description: 'Document and surface common board shortcuts for power users.' },
    fr: { title: 'Aide aux raccourcis clavier', description: 'Documenter et afficher les raccourcis du tableau pour les utilisateurs avancés.' },
  },
  project_docs: {
    en: { title: 'Set up project documentation', description: 'Create comprehensive project documentation including README, API docs, and user guides.' },
    fr: { title: 'Mettre en place la documentation', description: 'Créer la documentation projet : README, API et guides utilisateur.' },
  },
  ui_mockups: {
    en: { title: 'Design user interface mockups', description: 'Create wireframes and mockups for the new dashboard interface.' },
    fr: { title: 'Maquettes d’interface', description: 'Créer wireframes et maquettes pour le nouveau tableau de bord.' },
  },
  onboarding_checklist: {
    en: { title: 'Polish onboarding checklist', description: 'Add empty-state tips and a short checklist for first-time board setup.' },
    fr: { title: 'Peaufiner la checklist d’accueil', description: 'Ajouter des conseils d’état vide et une courte checklist pour le premier tableau.' },
  },
  user_auth: {
    en: { title: 'Implement user authentication', description: 'Build secure login system with JWT tokens and password hashing.' },
    fr: { title: 'Implémenter l’authentification', description: 'Mettre en place une connexion sécurisée (JWT et hachage des mots de passe).' },
  },
  db_schema: {
    en: { title: 'Create database schema', description: 'Design and implement the database structure with proper relationships and indexes.' },
    fr: { title: 'Créer le schéma de base de données', description: 'Concevoir et implémenter la structure, les relations et les index.' },
  },
  cicd: {
    en: { title: 'Set up CI/CD pipeline', description: 'Configure automated testing and deployment workflows using GitHub Actions.' },
    fr: { title: 'Mettre en place la CI/CD', description: 'Configurer tests et déploiements automatisés avec GitHub Actions.' },
  },
  search_relevance: {
    en: { title: 'Improve task search relevance', description: 'Rank ticket IDs and titles ahead of description matches in header search.' },
    fr: { title: 'Améliorer la pertinence de la recherche', description: 'Prioriser les IDs de tickets et les titres avant les descriptions dans la recherche.' },
  },
  socket_banner: {
    en: { title: 'Socket reconnect banner', description: 'Show a non-blocking banner when the realtime connection drops and recovers.' },
    fr: { title: 'Bandeau de reconnexion', description: 'Afficher un bandeau non bloquant si la connexion temps réel tombe puis revient.' },
  },
  api_unit_tests: {
    en: { title: 'Write unit tests for API endpoints', description: 'Create comprehensive test coverage for all REST API endpoints.' },
    fr: { title: 'Écrire les tests unitaires API', description: 'Couvrir tous les endpoints REST par des tests.' },
  },
  security_audit: {
    en: { title: 'Perform security audit', description: 'Review code for security vulnerabilities and implement necessary fixes.' },
    fr: { title: 'Réaliser un audit de sécurité', description: 'Revoir le code pour les failles et appliquer les correctifs nécessaires.' },
  },
  cross_browser: {
    en: { title: 'Test cross-browser compatibility', description: 'Ensure the application works correctly across different browsers and devices.' },
    fr: { title: 'Tester la compatibilité navigateurs', description: 'Vérifier que l’application fonctionne sur différents navigateurs et appareils.' },
  },
  sprint_filter_qa: {
    en: { title: 'Verify sprint filter edge cases', description: 'QA backlog vs sprint views, including tasks moved between sprints mid-cycle.' },
    fr: { title: 'QA du filtre de sprint', description: 'Tester backlog vs sprint, y compris les tâches déplacées en cours de cycle.' },
  },
  project_planning: {
    en: { title: 'Project planning and requirements gathering', description: 'Conducted stakeholder interviews and documented all project requirements.' },
    fr: { title: 'Planification et recueil des besoins', description: 'Entretiens parties prenantes et documentation des exigences.' },
  },
  dev_environment: {
    en: { title: 'Set up development environment', description: 'Configured local development setup with all necessary tools and dependencies.' },
    fr: { title: 'Installer l’environnement de développement', description: 'Configurer l’environnement local avec les outils et dépendances.' },
  },
  project_structure: {
    en: { title: 'Create initial project structure', description: 'Set up the basic project architecture and folder structure.' },
    fr: { title: 'Créer la structure initiale du projet', description: 'Mettre en place l’architecture et l’arborescence de base.' },
  },
  sprint_filter_wire: {
    en: { title: 'Wire sprint filter on board view', description: 'Let the board show backlog vs an active sprint without losing column layout.' },
    fr: { title: 'Brancher le filtre de sprint', description: 'Afficher backlog vs sprint actif sans perdre la disposition des colonnes.' },
  },
  legacy_removal: {
    en: { title: 'Legacy feature removal', description: 'Removed deprecated features that are no longer needed in the current version.' },
    fr: { title: 'Retrait des fonctionnalités obsolètes', description: 'Supprimer les fonctions dépréciées devenues inutiles.' },
  },
  old_docs_cleanup: {
    en: { title: 'Old documentation cleanup', description: 'Archived outdated documentation and updated references to current versions.' },
    fr: { title: 'Nettoyage de l’ancienne documentation', description: 'Archiver la doc périmée et mettre à jour les références.' },
  },
};

export const DEMO_TAGS_BY_KEY = {
  project_docs: ['documentation'],
  ui_mockups: ['frontend'],
  research_integrations: ['backend'],
  user_auth: ['backend', 'security'],
  db_schema: ['database', 'backend'],
  cicd: ['backend'],
  api_unit_tests: ['backend', 'testing'],
  security_audit: ['security', 'backend'],
  cross_browser: ['frontend', 'testing'],
  project_planning: ['documentation'],
  api_versioning: ['documentation'],
  legacy_removal: ['backend'],
};

export const DEMO_RELATIONSHIPS = [
  { parentKey: 'db_schema', childKey: 'user_auth', type: 'parent' },
  { parentKey: 'user_auth', childKey: 'api_unit_tests', type: 'parent' },
  { parentKey: 'project_planning', childKey: 'project_docs', type: 'parent' },
  { task1Key: 'ui_mockups', task2Key: 'cross_browser', type: 'related' },
];

export const DEMO_COMMENTS = [
  { key: 'user_auth', memberIndex: 1, createdDaysAgo: 2, en: 'Started implementing JWT token authentication. Should be ready by EOD tomorrow.', fr: 'J’ai commencé l’auth JWT. Prêt pour demain soir.' },
  { key: 'user_auth', memberIndex: 0, createdDaysAgo: 2, en: 'Great! Make sure to add refresh token functionality as well.', fr: 'Super ! Pense aussi aux refresh tokens.' },
  { key: 'db_schema', memberIndex: 0, createdDaysAgo: 5, en: 'Database schema design is complete. Moving to implementation phase.', fr: 'Le schéma est prêt. On passe à l’implémentation.' },
  { key: 'api_unit_tests', memberIndex: 1, createdDaysAgo: 1, en: 'Added test coverage for all authentication endpoints. Coverage is now at 85%.', fr: 'Couverture des endpoints d’auth : 85 %.' },
  { key: 'security_audit', memberIndex: 2, createdDaysAgo: 3, en: 'Found a few SQL injection vulnerabilities. Creating tasks to fix them.', fr: 'Quelques injections SQL. Je crée des tickets pour corriger.' },
  { key: 'security_audit', memberIndex: 0, createdDaysAgo: 3, en: 'Thanks for catching those! Let\'s prioritize the fixes.', fr: 'Merci de les avoir vues ! On priorise les correctifs.' },
  { key: 'project_docs', memberIndex: 0, createdDaysAgo: 1, en: 'Working on API documentation. Will use OpenAPI/Swagger format.', fr: 'Doc API en cours, format OpenAPI/Swagger.' },
];

export const DEMO_ACTIVITY = [
  { key: 'project_planning', memberIndex: 0, action: 'completed', daysAgo: 6 },
  { key: 'dev_environment', memberIndex: 1, action: 'completed', daysAgo: 4 },
  { key: 'project_structure', memberIndex: 2, action: 'completed', daysAgo: 3 },
  { key: 'legacy_removal', memberIndex: 2, action: 'completed', daysAgo: 11 },
  { key: 'old_docs_cleanup', memberIndex: 0, action: 'completed', daysAgo: 8 },
  { key: 'sprint_filter_wire', memberIndex: 3, action: 'completed', daysAgo: 5 },
  { key: 'project_docs', memberIndex: 3, action: 'created', daysAgo: 12 },
  { key: 'ui_mockups', memberIndex: 1, action: 'created', daysAgo: 11 },
  { key: 'user_auth', memberIndex: 2, action: 'created', daysAgo: 9 },
  { key: 'db_schema', memberIndex: 3, action: 'created', daysAgo: 8 },
  { key: 'cicd', memberIndex: 1, action: 'created', daysAgo: 7 },
  { key: 'ui_mockups', memberIndex: 0, action: 'commented', daysAgo: 5 },
  { key: 'user_auth', memberIndex: 1, action: 'commented', daysAgo: 4 },
  { key: 'security_audit', memberIndex: 2, action: 'commented', daysAgo: 3 },
  { key: 'project_docs', memberIndex: 0, action: 'commented', daysAgo: 1 },
];
