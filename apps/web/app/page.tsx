import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { RestApi } from "@/components/RestApi";
import { Fees } from "@/components/Fees";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";

export default function HomePage() {
  return (
    <>
      <Nav />
      <a id="top"></a>
      <Hero />
      <Features />
      <RestApi />
      <Fees />
      <Faq />
      <Footer />
    </>
  );
}
