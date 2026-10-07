import {
  classifyMail,
  classifyRejection,
  htmlToText,
  companyFromSender,
  matchRejection,
  rejectionMarker,
  sameApplication,
  type SheetRow,
  type MailItem,
} from './parse';
import { messageToItem, parseFrom } from './gmail-message';

// casi portati dai test di job-compiler: stesso parser, stessi risultati attesi
const eq = (name: string, got: unknown, want: unknown) => {
  test(name, () => expect(JSON.stringify(got)).toBe(JSON.stringify(want)));
};

const mail = (p: Partial<MailItem>): MailItem => ({
  threadId: '18a0000000000000',
  name: '',
  email: '',
  subject: '',
  snippet: '',
  date: '2026-09-15',
  ...p,
});
const pick = (m: MailItem) => {
  const v = classifyMail(m);
  return v.accept ? { company: v.company, title: v.title, portal: v.portal } : { ignored: v.reason.split(' (')[0] };
};
const pickLoc = (m: MailItem) => {
  const v = classifyMail(m);
  return { company: v.company, title: v.title, location: v.location, portal: v.portal };
};

// Portals
eq(
  'indeed it',
  pick(
    mail({
      name: 'Indeed',
      email: 'indeedapply@indeed.com',
      subject: 'Indeed Application: Sviluppatore Full Stack',
      snippet: 'La tua candidatura è stata inviata a Acme Srl. Buona fortuna!',
    }),
  ),
  { company: 'Acme Srl', title: 'Sviluppatore Full Stack', portal: 'Indeed' },
);

eq(
  'indeed fr',
  pick(
    mail({
      name: 'Indeed',
      email: 'indeedapply@indeed.com',
      subject: 'Candidature Indeed : Développeur Angular',
      snippet: 'Votre candidature a été envoyée à Société Générale. Bonne chance',
    }),
  ),
  { company: 'Société Générale', title: 'Développeur Angular', portal: 'Indeed' },
);

eq(
  'linkedin en',
  pick(
    mail({
      name: 'LinkedIn',
      email: 'jobs-noreply@linkedin.com',
      subject: 'Alex, your application was sent to Contoso',
      snippet: 'Your application was sent to Contoso',
    }),
  ),
  { company: 'Contoso', title: '', portal: 'LinkedIn' },
);

eq(
  'linkedin it',
  pick(
    mail({
      name: 'LinkedIn',
      email: 'jobs-noreply@linkedin.com',
      subject: 'Alex, la tua candidatura è stata inviata a Fabrikam',
    }),
  ),
  { company: 'Fabrikam', title: '', portal: 'LinkedIn' },
);

// Company's own ATS
eq(
  'greenhouse thank you',
  pick(
    mail({
      name: 'Northwind Recruiting',
      email: 'no-reply@us.greenhouse-mail.io',
      subject: 'Thank you for applying to Northwind',
      snippet: 'Thanks for applying for the Senior TypeScript Engineer position at Northwind. We will review',
    }),
  ),
  { company: 'Northwind', title: 'Senior TypeScript Engineer', portal: 'Greenhouse' },
);

eq(
  'direct it',
  pick(
    mail({
      name: 'Risorse Umane Tailspin',
      email: 'hr@tailspin.it',
      subject: 'Grazie per la tua candidatura',
      snippet: 'Gentile Alex, grazie per la candidatura per la posizione di Backend Developer presso Tailspin.',
    }),
  ),
  { company: 'Tailspin', title: 'Backend Developer', portal: 'Sito aziendale' },
);

eq(
  'fallback to domain',
  pick(
    mail({
      name: '',
      email: 'jobs@wide-world-importers.fr',
      subject: 'Nous avons bien reçu votre candidature',
    }),
  ),
  { company: 'Wide World Importers', title: '', portal: 'Sito aziendale' },
);

// Only receipts count
eq(
  'no receipt phrase',
  pick(
    mail({
      name: 'Acme HR',
      email: 'hr@acme.com',
      subject: 'Il tuo profilo',
      snippet: 'Ciao Alex, abbiamo visto il tuo CV su LinkedIn',
    }),
  ),
  { ignored: 'nessuna frase di ricevuta candidatura' },
);
eq(
  'receipt phrase only in body',
  pick(
    mail({
      name: 'Acme',
      email: 'jobs@acme.com',
      subject: 'Acme - Frontend Developer',
      snippet: 'Hi Alex,',
      body: 'Hi Alex,\nThank you for applying to Acme! We will review your profile.',
    }),
  ),
  { company: 'Acme', title: '', portal: 'Sito aziendale' },
);
eq(
  'rejection opening like a receipt',
  pick(
    mail({
      name: 'Acme',
      email: 'jobs@acme.com',
      subject: 'Grazie per la tua candidatura',
      snippet: 'Ciao Alex, grazie per la tua candidatura.',
      body: "Ciao Alex,\ngrazie per la tua candidatura per la posizione di Backend Developer.\nDopo un'attenta valutazione abbiamo deciso di proseguire con altri candidati.",
    }),
  ),
  { ignored: 'esito negativo' },
);
eq(
  'interview invitation',
  pick(
    mail({
      name: 'Acme',
      email: 'jobs@acme.com',
      subject: 'Invito a colloquio - Backend Developer',
      snippet: 'Grazie per la tua candidatura, vorremmo conoscerti',
    }),
  ),
  { ignored: 'invito a colloquio' },
);
eq(
  'indeed footer mentioning interview is fine',
  pick(
    mail({
      name: 'Indeed Apply',
      email: 'indeedapply@indeed.com',
      subject: 'Indeed Application: Dev',
      snippet: 'Your application has been submitted.',
      body: 'Application submitted\nDev\nAcme\n- Milano\nThe following items were sent to Acme. Good luck!\nNever share financial info or take job offers without an interview.',
    }),
  ),
  { company: 'Acme', title: 'Dev', portal: 'Indeed' },
);

// Ignored
eq(
  'job alert ignored',
  pick(mail({ name: 'Indeed', email: 'alert@indeed.com', subject: '15 nuove offerte per developer a Milano' })),
  { ignored: 'avviso di offerte' },
);
eq(
  'rejection ignored',
  pick(
    mail({
      name: 'Acme',
      email: 'hr@acme.com',
      subject: 'La tua candidatura',
      snippet: 'Purtroppo abbiamo scelto un altro profilo',
    }),
  ),
  { ignored: 'esito negativo' },
);
eq(
  'incomplete ignored',
  pick(mail({ name: 'Indeed', email: 'x@indeed.com', subject: 'Completa la tua candidatura per Dev' })),
  { ignored: 'candidatura non completata' },
);
eq(
  'portal without company ignored',
  pick(mail({ name: 'Indeed', email: 'x@indeed.com', subject: 'Candidatura inviata' })),
  { ignored: 'né azienda né posizione riconoscibili' },
);
eq(
  'ignoreSenders',
  classifyMail(mail({ email: 'news@spam.com', subject: 'Thank you for applying to X' }), ['spam.com']).accept,
  false,
);

// Shapes observed in real mail (names changed)
const indeedBody = (status: string, sentTo: string) =>
  `We'll help you get started\n${status}\nDéveloppeur Full Stack Node.js / Angular - (H/F)\nAcme\n- Lyon, Auvergne-Rhône-Alpes, FR\n9 avis\n${sentTo}\n•\nCandidature`;
eq(
  'indeed body fr',
  pickLoc(
    mail({
      name: 'Indeed Apply',
      email: 'indeedapply@indeed.com',
      subject: 'Candidatures via Indeed : Développeur Full Stack Node.js / Angular - (H/F)',
      snippet: 'Votre candidature a été envoyée. Bonne chance !',
      body: indeedBody('Candidature envoyée', 'Les éléments suivants ont été envoyés à Acme. Bonne chance !'),
    }),
  ),
  {
    company: 'Acme',
    title: 'Développeur Full Stack Node.js / Angular - (H/F)',
    location: 'Lyon, Auvergne-Rhône-Alpes, FR',
    portal: 'Indeed',
  },
);
eq(
  'indeed body it',
  pickLoc(
    mail({
      name: 'Candidatura diretta.',
      email: 'indeedapply@indeed.com',
      subject: 'Candidatura per React developer attraverso Indeed',
      body: 'Candidatura inviata\nReact developer\nContoso\n- MILANO (MI)\n19.478 recensioni\nI seguenti elementi sono stati inviati a Contoso. In bocca al lupo!',
    }),
  ),
  { company: 'Contoso', title: 'React developer', location: 'MILANO (MI)', portal: 'Indeed' },
);
eq(
  'indeed subject only',
  pick(
    mail({
      name: 'Indeed Apply',
      email: 'indeedapply@indeed.com',
      subject: 'Indeed Application: Junior Front-end Developer',
      snippet: 'Your application has been submitted. Good luck!',
    }),
  ),
  { company: '', title: 'Junior Front-end Developer', portal: 'Indeed' },
);
eq(
  'workable body',
  pick(
    mail({
      name: 'Workable',
      email: 'noreply@candidates.workablemail.com',
      subject: 'Thanks for applying to Northwind',
      snippet: '-- Your application for the Senior Software Engineer - Web App & DevEx job was submitted successfully.',
    }),
  ),
  { company: 'Northwind', title: 'Senior Software Engineer - Web App & DevEx', portal: 'Workable' },
);
eq(
  'teamtailor recruiter name',
  pick(
    mail({
      name: 'Jane Doe - Repr.',
      email: 'jane@represent.teamtailor-mail.com',
      subject: 'We have received your application!',
      snippet:
        'Thank you for your application. We appreciate your interest in joining Represent. We will review your application for Senior frontend web developer (Europe) shortly, and get back',
    }),
  ),
  { company: 'Represent', title: 'Senior frontend web developer (Europe)', portal: 'Teamtailor' },
);
eq(
  'snippet cut, body complete',
  pick(
    mail({
      name: 'Jane Doe - Di.',
      email: 'jane@dignify.teamtailor-mail.com',
      subject: 'We have received your application!',
      snippet:
        'Thank you for your application. We appreciate your interest in joining Dignify. We will review your application for Medior',
      body: 'Thank you for your application. We appreciate your interest in joining Dignify.\nWe will review your application for Medior Frontend Developer shortly, and get back to you.',
    }),
  ),
  { company: 'Dignify', title: 'Medior Frontend Developer', portal: 'Teamtailor' },
);
eq(
  'interest in the X position',
  pick(
    mail({
      name: 'Litware Sagl',
      email: 'hr@litware.ch',
      subject: 'Your application at Litware Sagl - received successfully!',
      body: 'Dear Alex,\nthank you for your interest in the [CH] Senior ReactJS / React Native Developer position. We will',
    }),
  ),
  { company: 'Litware Sagl', title: '[CH] Senior ReactJS / React Native Developer', portal: 'Sito aziendale' },
);
eq(
  'french poste title',
  pick(
    mail({
      name: 'Tailspin',
      email: 'rh@tailspin.fr',
      subject: 'Accusé de réception de votre candidature',
      body: 'Bonjour Alex,\nNous avons bien reçu votre candidature pour le poste Tech Lead et nous vous en remercions.',
    }),
  ),
  { company: 'Tailspin', title: 'Tech Lead', portal: 'Sito aziendale' },
);
eq(
  'generic title dropped',
  pick(
    mail({
      name: 'Fabrikam',
      email: 'jobs@fabrikam.com',
      subject: 'Job application successful.',
      body: 'Thank you for your application for a job at Fabrikam.',
    }),
  ),
  { company: 'Fabrikam', title: '', portal: 'Sito aziendale' },
);
eq(
  'sender name that is an address',
  pick(
    mail({
      name: 'jane.doe',
      email: 'jane.doe@wide-world.fr',
      subject: 'Suivi de votre candidature',
      body: 'Bonjour, merci pour votre candidature. Nous revenons vers vous rapidement.',
    }),
  ),
  { company: 'Wide World', title: '', portal: 'Sito aziendale' },
);
eq(
  'smartrecruiters position of',
  pick(
    mail({
      name: 'Fabrikam LLC',
      email: 'noreply@smartrecruiters.com',
      subject: 'Thank you for applying to Fabrikam LLC',
      body: 'Dear ALEX,\nThank you for submitting your application for the position of Junior Front-end Developer. We will review',
    }),
  ),
  { company: 'Fabrikam LLC', title: 'Junior Front-end Developer', portal: 'SmartRecruiters' },
);
eq(
  'italian body wrapped',
  pick(
    mail({
      name: 'tailspin',
      email: 'noreply@myworkday.com',
      subject: 'Grazie per la tua candidatura!',
      body: 'Ciao Alex ,\nAbbiamo ricevuto la tua candidatura per la posizione di Backend\nDeveloper Node.JS Typescript !\nQuali sono i next step',
    }),
  ),
  { company: 'tailspin', title: 'Backend Developer Node.JS Typescript', portal: 'Workday' },
);
eq(
  'agency title stops at verb',
  pick(
    mail({
      name: 'Hays',
      email: 'x@notification.hays.com',
      subject: 'Grazie per la tua candidatura',
      snippet: 'La tua candidatura per Full Stack Developer (Ref: 954246) è stata inoltrata al consulente',
    }),
  ).title,
  'Full Stack Developer',
);
eq(
  'eta payment ignored',
  pick(
    mail({
      name: 'UKVI',
      email: 'x@worldpay.com',
      subject: 'ETA Payment Confirmation',
      snippet: 'The payment for your electronic travel authorisation (ETA) application has been completed',
    }),
  ),
  { ignored: 'non è una candidatura di lavoro' },
);
eq(
  'html to text',
  htmlToText(
    '<html><head><style>x{}</style></head><body><p>Ciao&nbsp;Alex,</p>grazie &amp; a presto&#33; &#x27;ok&#x27;</body></html>',
  ),
  "Ciao Alex,\ngrazie & a presto! 'ok'",
);

// Sender cleanup
eq('sender careers', companyFromSender('Acme Careers', 'careers@acme.com'), 'Acme');
eq('sender via', companyFromSender('Acme via Workday', 'x@myworkday.com'), 'Acme');
eq('webmail no company', companyFromSender('', 'someone@gmail.com'), '');
eq('ats domain no company', companyFromSender('no-reply', 'no-reply@smartrecruiters.com'), '');

// Duplicate detection
eq(
  'same: suffix + title',
  sameApplication(
    { company: 'Acme S.r.l.', title: 'Sviluppatore Full Stack (TypeScript)', date: '2026-09-14' },
    { company: 'Acme Srl', title: 'Sviluppatore Full Stack', date: '2026-09-14' },
  ),
  true,
);
eq(
  'same: no title, close dates',
  sameApplication(
    { company: 'Contoso', title: 'Angular Developer', date: '2026-09-14' },
    { company: 'Contoso SpA', title: '', date: '2026-09-15' },
  ),
  true,
);
eq(
  'different: no title, far dates',
  sameApplication(
    { company: 'Contoso', title: 'Angular Developer', date: '2026-08-01' },
    { company: 'Contoso', title: '', date: '2026-09-15' },
  ),
  false,
);
eq(
  'different: other role same company',
  sameApplication(
    { company: 'Contoso', title: 'Data Engineer', date: '2026-09-14' },
    { company: 'Contoso', title: 'Frontend Angular Developer', date: '2026-09-14' },
  ),
  false,
);
eq(
  'different companies',
  sameApplication(
    { company: 'Acme', title: 'Dev', date: '2026-09-14' },
    { company: 'Fabrikam', title: 'Dev', date: '2026-09-14' },
  ),
  false,
);

// Rejections
const rejectedAs = (m: MailItem) => {
  const v = classifyRejection(m);
  return v.accept ? { company: v.company, title: v.title } : { ignored: v.reason.split(' (')[0] };
};
eq(
  'rejection it',
  rejectedAs(
    mail({
      name: 'Acme Recruiting',
      email: 'jobs@acme.it',
      subject: 'Aggiornamento sulla tua candidatura',
      body: 'Ciao Alex,\ngrazie per la tua candidatura per la posizione di Backend Developer.\nPurtroppo abbiamo deciso di proseguire con altri candidati.',
    }),
  ),
  { company: 'Acme', title: 'Backend Developer' },
);
eq(
  'rejection en via ATS',
  rejectedAs(
    mail({
      name: 'Northwind',
      email: 'no-reply@greenhouse.io',
      subject: 'Your application to Northwind',
      body: 'Hi Alex,\nThank you for applying for the Senior TypeScript Engineer position at Northwind. Unfortunately, we will not be moving forward.',
    }),
  ),
  { company: 'Northwind', title: 'Senior TypeScript Engineer' },
);
eq(
  'rejection fr',
  rejectedAs(
    mail({
      name: 'Tailspin RH',
      email: 'rh@tailspin.fr',
      subject: 'Votre candidature',
      body: 'Bonjour,\nNous vous remercions pour votre candidature au poste de Développeur Angular. Malheureusement, elle n’a pas été retenue.',
    }),
  ),
  { company: 'Tailspin', title: 'Développeur Angular' },
);
eq(
  'receipt is not a rejection',
  rejectedAs(
    mail({
      name: 'Acme',
      email: 'jobs@acme.com',
      subject: 'Thanks for applying to Acme',
      body: 'We received your application and will be in touch.',
    }),
  ),
  { ignored: 'nessuna frase di rifiuto' },
);
eq(
  'unfortunately without application context',
  rejectedAs(
    mail({
      name: 'Bank',
      email: 'noreply@bank.com',
      subject: 'Payment failed',
      body: 'Unfortunately your card was declined.',
    }),
  ),
  { ignored: 'non parla di una candidatura' },
);
eq(
  'job alert with unfortunately ignored',
  rejectedAs(
    mail({
      name: 'Indeed',
      email: 'alert@indeed.com',
      subject: '15 nuove offerte per te',
      snippet: 'Purtroppo la candidatura…',
    }),
  ),
  { ignored: 'avviso di offerte' },
);

eq(
  'portal nudge mentioning other candidates',
  rejectedAs(
    mail({
      name: 'Indeed',
      email: 'donotreply@match.indeed.com',
      subject: 'Distinguiti inviando un messaggio veloce a Acme',
      body: 'Acme potrebbe avere bisogno di tempo per esaminare tutte le candidature ricevute. Per distinguerti dagli altri candidati invia un messaggio.',
    }),
  ),
  { ignored: 'promemoria del portale' },
);
eq(
  'marketing with autres candidats',
  'ignored' in
    rejectedAs(
      mail({
        name: 'Free-Work',
        email: 'news@free-work.com',
        subject: 'Distinguez-vous auprès des recruteurs',
        body: 'Comparez votre profil à celui des autres candidats grâce à une évaluation de votre candidature.',
      }),
    ),
  true,
);
eq(
  'title after "for the position"',
  rejectedAs(
    mail({
      name: 'Ericsson',
      email: 'no-reply@ericsson.com',
      subject: 'Your opinion matters to us!',
      body: 'Thank you for taking the time to apply. We carefully reviewed your application for the position Entry Level Engineer. Unfortunately we decided to move on with other applicants.',
    }),
  ),
  { company: 'Ericsson', title: 'Entry Level Engineer' },
);
eq(
  'subject "Role position - Company - Name"',
  rejectedAs(
    mail({
      name: 'Raphael',
      email: 'raphael@aisg.example',
      subject: 'AI Engineer position - AISG - Alex Example',
      body: 'Hi Alex, thank you for your interest in the opportunity. Unfortunately we will not be moving forward with your application.',
    }),
  ),
  { company: 'AISG', title: 'AI Engineer' },
);
const rows: SheetRow[] = [
  {
    row: 2,
    key: 'jk1',
    date: '2026-08-10',
    company: 'Acme S.r.l.',
    title: 'Backend Developer',
    status: 'INVIATA',
    notes: '',
  },
  {
    row: 3,
    key: 'jk2',
    date: '2026-08-12',
    company: 'Acme',
    title: 'Frontend Developer',
    status: 'Colloquio',
    notes: '',
  },
  { row: 4, key: 'mail-t9', date: '2026-08-15', company: 'Contoso', title: '', status: 'INVIATA', notes: '' },
  { row: 5, key: 'jk3', date: '2026-08-20', company: 'Fabrikam', title: 'Dev', status: 'RIFIUTATA', notes: '' },
  { row: 6, key: 'jk4', date: '2026-10-01', company: 'Litware', title: 'Dev', status: 'INVIATA', notes: '' },
];
const match = (r: { company: string; title: string; date?: string; threadId?: string }) => {
  const m = matchRejection({ date: '2026-09-15', threadId: 'x', ...r }, rows);
  return m.kind === 'row' ? m.row.row : m.kind === 'ambiguous' ? m.rows.map((x) => x.row) : null;
};
eq('match by company + title', match({ company: 'Acme', title: 'Backend Developer' }), 2);
eq('title picks the right one of two', match({ company: 'Acme', title: 'Frontend Developer (Angular)' }), 3);
eq('same company, no title: ambiguous', match({ company: 'Acme', title: '' }), [2, 3]);
eq('single row for company, no title', match({ company: 'Contoso SpA', title: '' }), 4);
eq('same thread wins', match({ company: 'Other', title: '', threadId: 't9' }), 4);
eq('already rejected is not matched', match({ company: 'Fabrikam', title: 'Dev' }), null);
eq('row newer than the rejection is not matched', match({ company: 'Litware', title: 'Dev' }), null);
eq('unknown company', match({ company: 'Globex', title: 'Dev' }), null);
eq('marker', rejectionMarker('abc'), 'rifiuto: mail-abc');

// Gmail API messages
eq('from with name', parseFrom('"Acme Careers" <jobs@acme.com>'), { name: 'Acme Careers', email: 'jobs@acme.com' });
eq('from bare', parseFrom('jobs@acme.com'), { name: '', email: 'jobs@acme.com' });
const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64url');
const apiMsg = messageToItem({
  id: 'm1',
  threadId: '1a0c3561d1db800c',
  internalDate: String(Date.UTC(2026, 8, 19, 10, 0)),
  snippet: 'Your application has been submitted. Good luck! If you notice an error &amp; more',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Indeed Apply <indeedapply@indeed.com>' },
      { name: 'Subject', value: 'Indeed Application: Dev' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64('plain version') } },
      {
        mimeType: 'text/html',
        body: {
          data: b64(
            '<div>Application submitted</div><div>Dev</div><div>Acme</div><div>- Milano</div><p>The following items were sent to Acme. Good luck!</p>',
          ),
        },
      },
      { mimeType: 'application/pdf', filename: 'cv.pdf', body: { attachmentId: 'x' } },
    ],
  },
});
eq(
  'api message fields',
  apiMsg && { t: apiMsg.threadId, n: apiMsg.name, e: apiMsg.email, s: apiMsg.subject, d: apiMsg.date },
  {
    t: '1a0c3561d1db800c',
    n: 'Indeed Apply',
    e: 'indeedapply@indeed.com',
    s: 'Indeed Application: Dev',
    d: '2026-09-19',
  },
);
eq('api snippet unescaped', apiMsg?.snippet.endsWith('error & more'), true);
eq('api html body preferred', (apiMsg?.body ?? '').split('\n').slice(0, 3), ['Application submitted', 'Dev', 'Acme']);
eq('api message classified', apiMsg && pickLoc(apiMsg), {
  company: 'Acme',
  title: 'Dev',
  location: 'Milano',
  portal: 'Indeed',
});
