import ProductDetail from '@/components/ProductDetail';
import { resolveProduct } from './product-data';

// Server-rendered so the HTML already carries the product; the client reloads it for the signed-in context.
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetail initialProduct={await resolveProduct(id)} />;
}
