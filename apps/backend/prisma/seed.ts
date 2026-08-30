/**
 * Seeds the MVP category taxonomy (DECISIONS.md §1).
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

// Out of scope for MVP and intentionally absent: medical/dental (under Health &
// Wellness), catering (under Events), and delivery-style categories generally.
// This is an appointment platform, not a delivery platform.
const CATEGORIES: CategorySeed[] = [
  {
    name: 'Beauty & Personal Care',
    icon: 'sparkles',
    description: 'Salons, barbers, nails, skincare and makeup artists.',
    subcategories: [
      'Hair Salon',
      'Barbershop',
      'Nail Salon',
      'Makeup Artist',
      'Skincare & Facials',
      'Braiding & Locs',
    ],
  },
  {
    name: 'Health & Wellness',
    icon: 'heart-pulse',
    // Non-clinical only. Anything requiring a medical licence is out of scope.
    description:
      'Non-clinical wellness services. Excludes medical and dental care.',
    subcategories: [
      'Massage Therapy',
      'Personal Training',
      'Yoga & Pilates',
      'Nutrition Coaching',
      'Physiotherapy & Rehab',
      'Mental Wellness Coaching',
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
    ],
  },
  {
    name: 'Events',
    icon: 'calendar-star',
    // Catering is deliberately excluded — see DECISIONS.md §1.
    description: 'Event planning and services. Excludes catering.',
    subcategories: [
      'Event Planning',
      'Venue Booking',
      'DJ & Live Music',
      'Event Decor & Styling',
      'MC & Hosting',
      'Equipment Rental',
    ],
  },
  {
    name: 'Home Services',
    icon: 'home-tools',
    description: 'Repairs, maintenance and in-home trades.',
    subcategories: [
      'Cleaning Services',
      'Plumbing',
      'Electrical',
      'Painting & Decorating',
      'Carpentry & Furniture Repair',
      'Pest Control',
    ],
  },
  {
    name: 'Professional & Consulting',
    icon: 'briefcase',
    description: 'Advisory, legal, financial and business services.',
    subcategories: [
      'Legal Consultation',
      'Accounting & Tax',
      'Business Consulting',
      'IT & Tech Support',
      'Tutoring & Training',
      'Translation Services',
    ],
  },
  {
    name: 'Automotive',
    icon: 'car',
    description: 'Vehicle servicing, repair and detailing.',
    subcategories: [
      'Car Repair & Mechanic',
      'Car Wash & Detailing',
      'Tyre & Wheel Services',
      'Auto Electrical',
      'Vehicle Inspection',
    ],
  },
  {
    name: 'Pet Services',
    icon: 'paw',
    description: 'Grooming, training, sitting and non-veterinary pet care.',
    subcategories: [
      'Pet Grooming',
      'Dog Training',
      'Pet Sitting & Boarding',
      'Dog Walking',
      'Pet Transport',
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
