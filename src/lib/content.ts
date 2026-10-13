// Single source of truth for James Dean Golf business content.
// Fields marked TODO are placeholders pending real info from the client.

export const business = {
  name: "James Dean Golf",
  tagline: "Golf Lessons & Academy in Montreal",
  phone: "514-816-3454",
  phoneHref: "tel:+15148163454",
  email: "jamesdeanladeroute@gmail.com",
  instagramUrl: "https://www.instagram.com/jimmydeangolf",
  facebookUrl: "", // TODO: add Facebook page URL
};

export const locations = {
  summer: {
    label: "Summer",
    name: "Golf Dorval",
    address: "2000 Chemin Reverchon, Dorval, QC",
    mapsQuery: "Golf Dorval, 2000 Chemin Reverchon, Dorval, QC",
  },
  winter: {
    label: "Winter",
    name: "Royal Westcourt",
    address: "87 Montrose, Dollard-des-Ormeaux, QC",
    mapsQuery: "Royal Westcourt, 87 Montrose, Dollard-des-Ormeaux, QC",
  },
};

export type LessonPricing = {
  single: number;
  pack3: number;
  pack5: number;
};

export const individualLessons: {
  duration: string;
  extraPersonFee: number;
  summer: LessonPricing;
  winter: LessonPricing;
} = {
  duration: "55 minutes",
  extraPersonFee: 25,
  summer: { single: 110, pack3: 300, pack5: 500 },
  winter: { single: 115, pack3: 330, pack5: 520 },
};

export type Clinic = {
  number: number;
  title: string;
  description: string;
};

export type ClinicCohortId = "may" | "august" | "september";

export type ClinicCohort = {
  id: ClinicCohortId;
  month: string;
};

export const groupClinics = {
  maxParticipants: 10,
  sessionsCount: 4,
  sessionDuration: "90 minutes",
  pricePerPerson: 200,
  schedule: "Saturdays, 9:30 – 11:00 AM",
  // Each cohort is its own 4-week series (max 10 people) covering all 4
  // themed sessions below. Live spots-remaining per cohort come from
  // /api/clinic-capacity (backed by a Google Sheet).
  cohorts: [
    { id: "may", month: "May" },
    { id: "august", month: "August" },
    { id: "september", month: "September" },
  ] satisfies ClinicCohort[],
  clinics: [
    { number: 1, title: "Irons & Wedges", description: "Dial in contact and distance control with your irons and wedges." },
    { number: 2, title: "Short Game", description: "Chipping, pitching, and touch around the green." },
    { number: 3, title: "Long Hybrids, Woods & Driver", description: "Build speed and consistency off the tee and from the fairway." },
    { number: 4, title: "Specialty Shots Around the Green", description: "Bunker play, tight lies, and creative recovery shots." },
  ] satisfies Clinic[],
};

export const juniorPrograms = {
  weeks: 6,
  hoursPerSession: 2,
  frequency: "Once a week",
  price: 480,
  priceNote: "+ tax per person",
  maxPerGroup: 10,
  multipleNightsNote:
    "Depending on demand, sessions may run on multiple nights per week.",
  curriculum: [
    "Proper golf swing technique",
    "Strength & mobility through multisport training methods",
    "Engaging games and challenges",
    "Training with world-class TrackMan technology",
  ],
  // TODO: confirm exact weekly day/time and age range per season.
  seasons: [
    { season: "Fall", venue: "winter" as const },
    { season: "Winter", venue: "winter" as const },
    { season: "Spring", venue: "winter" as const },
  ],
};

export type CampWeekId =
  | "jun22"
  | "jun29"
  | "jul06"
  | "jul13"
  | "jul20"
  | "jul27"
  | "aug03"
  | "aug10"
  | "aug17"
  | "aug24";

export type CampWeek = {
  id: CampWeekId;
  label: string;
  dates: string;
};

export const juniorCamps = {
  pricePerWeek: 380,
  priceNote: "+ tax per person",
  maxPerWeek: 30,
  hours: "9:30 AM – 4:00 PM",
  hoursLabel: "Full Day Camps",
  venue: "summer" as const,
  cancellationFee: 50,
  // Live spots-remaining per week come from /api/camp-capacity (backed by
  // the same Google Sheet as clinic sign-ups, on a separate tab).
  weeks: [
    { id: "jun22", label: "June 22, 23, 25 & 26", dates: "June 22, 23, 25, 26" },
    { id: "jun29", label: "June 29, 30 & July 2, 3", dates: "June 29, 30, July 2, 3" },
    { id: "jul06", label: "July 6, 7, 8 & 9", dates: "July 6, 7, 8, 9" },
    { id: "jul13", label: "July 13, 14, 15 & 16", dates: "July 13, 14, 15, 16" },
    { id: "jul20", label: "July 20, 21, 22 & 23", dates: "July 20, 21, 22, 23" },
    { id: "jul27", label: "July 27, 28, 29 & 30", dates: "July 27, 28, 29, 30" },
    { id: "aug03", label: "August 3, 4, 5 & 6", dates: "August 3, 4, 5, 6" },
    { id: "aug10", label: "August 10, 11, 12 & 13", dates: "August 10, 11, 12, 13" },
    { id: "aug17", label: "August 17, 18, 19 & 20", dates: "August 17, 18, 19, 20" },
    { id: "aug24", label: "August 24, 25, 26 & 27", dates: "August 24, 25, 26, 27" },
  ] satisfies CampWeek[],
};

export const bio = {
  intro:
    "I'm Coach James — a CPGA Golf Professional, competitor, and lifelong multi-sport athlete. Before dedicating myself fully to golf, I competed at the national level in go-karting and became a Quebec Bronze Gloves boxing champion. These experiences shaped my discipline, mental toughness, and drive to succeed — qualities I now pass on to my students.",
  journey:
    "My golf journey began with years of competition in elite junior and amateur events across Quebec, building a strong foundation in tournament play and pressure performance. I've also had the privilege of attending the Butch Harmon School of Golf three times, learning from some of the best in the game.",
  closing:
    "Today, as a coach at both Dorval Golf Club and Royal Westcourt Social Club, I'm focused on helping golfers of all levels improve their game, build confidence, and enjoy every step of the process.",
  currentRoles: [
    "CPGA Golf Professional at Royal Westcourt Social Club",
    "CPGA Golf Professional at Dorval Golf Club",
  ],
  golfBackground: [
    "Trained at the Butch Harmon School of Golf (3x)",
    "Competed extensively as a junior and amateur across Quebec and Canada",
    "Strong tournament experience in Golf Québec and CJGA events, including the Quebec Junior Boys’ Championship and U25 Championship",
  ],
  otherAchievements: [
    "Quebec Bronze Gloves Boxing Champion",
    "National-level Go-Karting Competitor",
  ],
  certifications: ["CPGA Certified Golf Professional"],
};

// Curated header/mobile-menu nav (per client request). "Book a Lesson" is
// added separately as the CTA button in the header, and as a plain link in
// the mobile menu.
export const primaryNav = [
  { label: "Golf Professional", href: "/about" },
  { label: "Group Clinics", href: "/clinics" },
  { label: "Junior Programs", href: "/junior-programs" },
  { label: "Junior Camps", href: "/junior-camps" },
];

// Full site map, used by the footer so every page stays reachable.
export const nav = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Individual Lessons", href: "/lessons" },
  { label: "Group Clinics", href: "/clinics" },
  { label: "Junior Programs", href: "/junior-programs" },
  { label: "Junior Camps", href: "/junior-camps" },
  { label: "Book a Lesson", href: "/book" },
  { label: "Contact", href: "/contact" },
];

// TODO: create a free Web3Forms access key at https://web3forms.com (just needs an email, no
// account/password) and paste it here. This powers the Contact page form, emailing a
// notification to the address above whenever someone submits. (The Group Clinics sign-up form
// uses the Google Sheets integration instead — see GOOGLE_SHEETS_SETUP.md.)
export const web3FormsAccessKey = "";
