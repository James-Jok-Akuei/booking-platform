/**
 * Seeds the category taxonomy (DECISIONS.md §1, §266).
 *
 * Deliberately a seed script rather than a migration: the taxonomy is product
 * data, not schema. Categories will be renamed, re-iconed and re-described as
 * the marketplace finds its shape, and that shouldn't mean writing a migration
 * every time. Run it as often as you like:
 *
 *   npm run prisma:seed
 *
 * Idempotent by name — upserts, never duplicates, and never deletes. Removing a
 * category is a deliberate manual act, because businesses point at these rows.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CategorySeed {
  name: string;
  icon: string;
  description: string;
  subcategories: string[];
}

// Everything a customer books and then goes to in person (§266): a chair, a
// table, a seat, a class, a court, a room, a fitting, a visit. Nothing is
// delivered — dining is dine-in or pick-up, and catering stays out.
//
// The list is meant to be COMPLETE for the market: an administrator switches
// off what is not wanted at launch (Categories in the console) rather than a
// developer adding what was missed. Each category's `icon` is the word for its
// fine-line drawing in the apps (`src/ui/lineArtData.ts`). Every category ends
// with "Other", so no business is turned away for not fitting a box.
//
// Names here are the names in the database: renaming one is a migration (see
// …_taxonomy_v2), because the seed upserts BY NAME and would otherwise add a
// second category beside the first.
const CATEGORIES: CategorySeed[] = [
  {
    name: 'Automotive',
    icon: 'car',
    description: 'Car servicing, repairs, washing and driving lessons.',
    subcategories: [
      'Car Repair & Mechanic',
      'Car Wash & Detailing',
      'Tyre & Wheel Services',
      'Auto Electrical',
      'Vehicle Inspection',
      'Driving School',
      'Other',
    ],
  },
  {
    name: 'Beauty & Spa',
    icon: 'sparkles',
    description: 'Hair, barbers, nails, lashes, make-up, massage and spa days.',
    subcategories: [
      'Hair',
      'Barbershop',
      'Braiding & Locs',
      'Nails',
      'Eyebrows & Lashes',
      'Hair Removal',
      'Facials',
      'Massage',
      'Make-up',
      'Med Spa',
      'Skin & Body Treatments',
      'Spa & Sauna',
      'Tattoo & Piercing',
      'Other',
    ],
  },
  {
    name: 'Dining',
    icon: 'utensils',
    description: 'Book a table, or order ahead and collect it yourself. No delivery.',
    subcategories: ['Dine-in', 'Pick-up', 'Private Dining', 'Other'],
  },
  {
    name: 'Event Services',
    icon: 'calendar-star',
    // Catering stays out — see DECISIONS.md §1.
    description: 'Planners, venues, DJs, MCs and decor for your own event. Excludes catering.',
    subcategories: [
      'Event Planning',
      'Venue Booking',
      'DJ & Live Music',
      'Event Decor & Styling',
      'MC & Hosting',
      'Equipment Rental',
      'Other',
    ],
  },
  {
    name: 'Events, Tickets & Movies',
    icon: 'ticket',
    description: 'Concerts, shows, films, matches and exhibitions to go to.',
    subcategories: [
      'Music & Concerts',
      'Theatre & Shows',
      'Movies',
      'Sporting Events',
      'Art Exhibits',
      'Comedy',
      'Festivals',
      'Other',
    ],
  },
  {
    name: 'Fashion & Tailoring',
    icon: 'shirt',
    description: 'Tailors, fittings, alterations, shoe repair and laundry.',
    subcategories: [
      'Tailoring & Alterations',
      'Custom Clothing',
      'Fittings & Styling',
      'Shoe Repair',
      'Laundry & Dry Cleaning',
      'Other',
    ],
  },
  {
    name: 'Fitness & Sports',
    icon: 'dumbbell',
    description: 'Gyms, pitches, courts, pools and sports clubs.',
    subcategories: [
      'Gym',
      'Football Pitch',
      'Sports Courts',
      'Swimming',
      'Martial Arts',
      'Dance Studio',
      'Pilates',
      'Other',
    ],
  },
  {
    name: 'Group Classes & Activities',
    icon: 'people',
    description: 'Classes and activities you join with other people.',
    subcategories: [
      'Sports & Fitness',
      'Educational',
      'Recreational',
      'Professional',
      'Art, Music & Culture',
      'Cooking Classes',
      "Kids' Activities",
      'Other',
    ],
  },
  {
    name: 'Health & Medical',
    icon: 'stethoscope',
    description: 'Clinics, dentists, eye care and tests, by appointment.',
    subcategories: [
      'General Clinic',
      'Dental',
      'Eye Care',
      'Dermatology',
      'Lab Tests',
      'Vaccinations',
      'Specialist Consultation',
      'Other',
    ],
  },
  {
    name: 'Home Services',
    icon: 'home-tools',
    description: 'Repairs, cleaning and trades, done at your home.',
    subcategories: [
      'Cleaning Services',
      'Plumbing',
      'Electrical',
      'Painting & Decorating',
      'Carpentry & Furniture Repair',
      'Pest Control',
      'Other',
    ],
  },
  {
    name: 'Hotels & Stays',
    icon: 'bed',
    description: 'Rooms, guesthouses, day passes and meeting rooms.',
    subcategories: [
      'Hotel Rooms',
      'Guesthouses & Lodges',
      'Apartments & Short Stays',
      'Day Passes & Pools',
      'Meeting & Conference Rooms',
      'Other',
    ],
  },
  {
    name: 'Pet Services',
    icon: 'paw',
    description: 'Grooming, training, sitting and vet visits.',
    subcategories: [
      'Pet Grooming',
      'Dog Training',
      'Pet Sitting & Boarding',
      'Dog Walking',
      'Pet Transport',
      'Veterinary Clinic',
      'Other',
    ],
  },
  {
    name: 'Photography & Creative Services',
    icon: 'camera',
    description: 'Photographers, videographers and creative studios.',
    subcategories: [
      'Portrait Photography',
      'Event Photography',
      'Product Photography',
      'Videography',
      'Graphic Design',
      'Studio Rental',
      'Recording Studio',
      'Other',
    ],
  },
  {
    name: 'Services',
    icon: 'briefcase',
    description: 'Lessons, coaching and expert advice, one to one.',
    subcategories: [
      'Personal Training',
      'Consultations',
      'Tutoring',
      'Coaching',
      'Legal Consultation',
      'Accounting & Tax',
      'Business Consulting',
      'IT & Tech Support',
      'Translation Services',
      'Other',
    ],
  },
  {
    name: 'Tours & Experiences',
    icon: 'mountain',
    description: 'Gorilla trekking, safaris, city tours, hikes and boat trips.',
    subcategories: [
      'Gorilla & Wildlife Trekking',
      'Safaris & Game Drives',
      'City & Cultural Tours',
      'Hiking & Nature Walks',
      'Boat & Lake Trips',
      'Adventure Activities',
      'Other',
    ],
  },
  {
    name: 'Wellness',
    icon: 'heart-pulse',
    description: 'Acupuncture, nutrition, chiropractic, yoga and therapy.',
    subcategories: [
      'Acupuncture',
      'Diet & Nutrition',
      'Chiropractic',
      'Meditation & Yoga',
      'Therapy',
      'Physiotherapy & Rehab',
      'Other',
    ],
  },
];

async function main() {
  console.log('Seeding category taxonomy...');

  for (const category of CATEGORIES) {
    const record = await prisma.category.upsert({
      where: { name: category.name },
      update: { icon: category.icon, description: category.description },
      create: {
        name: category.name,
        icon: category.icon,
        description: category.description,
      },
    });

    for (const name of category.subcategories) {
      await prisma.subcategory.upsert({
        // Compound unique — a subcategory name is only unique within its parent.
        where: { categoryId_name: { categoryId: record.id, name } },
        update: {},
        create: { categoryId: record.id, name },
      });
    }

    console.log(
      `  ${category.name} (${category.subcategories.length} subcategories)`,
    );
  }

  const [categories, subcategories] = await Promise.all([
    prisma.category.count(),
    prisma.subcategory.count(),
  ]);
  console.log(
    `Done. ${categories} categories, ${subcategories} subcategories in database.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
