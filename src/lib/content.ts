// Single source of truth for Jimmy Dean Golf business content.
// Fields marked TODO are placeholders pending real info from the client.

export const business = {
  name: "Jimmy Dean Golf",
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

export const groupClinics = {
  maxParticipants: 10,
  sessionsCount: 4,
  sessionDuration: "90 minutes",
  pricePerPerson: 200,
  months: ["May", "August", "September"],
  schedule: "Saturdays, 9:30 – 11:00 AM",
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
    { season: "Fall", venue: "summer" as const },
    { season: "Winter", venue: "winter" as const },
    { season: "Spring", venue: "summer" as const },
  ],
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
    "Motocross racer with a passion for speed and precision",
  ],
  certifications: ["CPGA Certified Golf Professional"],
};

export const nav = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Individual Lessons", href: "/lessons" },
  { label: "Group Clinics", href: "/clinics" },
  { label: "Junior Programs", href: "/junior-programs" },
  { label: "Book a Lesson", href: "/book" },
  { label: "Contact", href: "/contact" },
];

// TODO: create a Google Calendar Appointment Schedule (calendar.google.com > + Create > Appointment schedule)
// for 1:1 lesson bookings, then paste its public booking-page URL here. Google will handle
// availability, auto-insert into your calendar, and email you whenever someone books.
export const googleAppointmentScheduleUrl = "";

// TODO: create a free Web3Forms access key at https://web3forms.com (just needs an email, no
// account/password) and paste it here. This powers the Group Clinics sign-up and Contact forms,
// emailing a notification to the address above whenever someone submits.
export const web3FormsAccessKey = "";
