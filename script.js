// Load header and footer components
async function loadComponents() {
    // Load header
    const headerElement = document.querySelector('header');
    if (headerElement && headerElement.dataset.component === 'header') {
        try {
            const response = await fetch('components/header.html', { cache: 'no-cache' });
            const html = await response.text();
            headerElement.innerHTML = html;
        } catch (error) {
            console.error('Error loading header:', error);
        }
    }

    // Load footer
    const footerElement = document.querySelector('footer');
    if (footerElement && footerElement.dataset.component === 'footer') {
        try {
            const response = await fetch('components/footer.html');
            const html = await response.text();
            footerElement.innerHTML = html;
        } catch (error) {
            console.error('Error loading footer:', error);
        }
    }

    // Initialize all functionality after components are loaded
    initNavigation();
    initHeroSlideshow();
    initJoinButton();
    initSmoothScroll();
    initBlogSection();
    initProductsSection();
}

async function initProductsSection() {
    const container = document.getElementById('productList');
    if (!container) return;
    try {
        const response = await fetch('products-proxy.php', { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Products request failed: ${response.status}`);
        const products = await response.json();
        if (!Array.isArray(products)) throw new Error('Invalid products response');
        container.replaceChildren();
        if (!products.length) {
            container.innerHTML = '<p class="products-status">No products are available at the moment.</p>';
            return;
        }
        products.slice(0, 4).forEach(product => {
            const card = document.createElement('article');
            card.className = 'product-card';
            const imageUrl = safeProductUrl(product.images?.[0]?.src);
            const name = stripHtml(product.name || 'Product');
            card.innerHTML = `
                ${imageUrl ? `<img class="product-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" loading="lazy">` : '<div class="product-image product-placeholder" aria-hidden="true"><i class="fas fa-seedling"></i></div>'}
                <div class="product-card-body">
                    <h3>${escapeHtml(name)}</h3>
                    <p class="product-price">${escapeHtml(formatProductPrice(product.prices))}</p>
                    ${product.is_in_stock === false ? '<p class="product-stock">Out of stock</p>' : ''}
                    <a class="blog-read-link" href="${escapeHtml(safeProductUrl(product.permalink) || document.getElementById('shopLink').href)}" target="_blank" rel="noopener noreferrer">View product <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
                </div>`;
            const img = card.querySelector('img');
            if (img) img.addEventListener('error', () => {
                const placeholder = document.createElement('div');
                placeholder.className = 'product-image product-placeholder';
                placeholder.textContent = 'Image unavailable';
                img.replaceWith(placeholder);
            }, { once: true });
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error loading products:', error);
        container.innerHTML = '<p class="products-status">Unable to load products right now. Please try again later.</p>';
    } finally {
        container.setAttribute('aria-busy', 'false');
    }
}

function safeProductUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}

function formatProductPrice(prices) {
    if (!prices || prices.price === '' || prices.price == null) return 'See product for pricing';
    const units = Number(prices.currency_minor_unit ?? 2);
    const format = value => {
        const amount = Number(value) / (10 ** units);
        if (!Number.isFinite(amount)) throw new Error('Invalid product price');
        try {
            return new Intl.NumberFormat('en-GB', { style: 'currency', currency: prices.currency_code }).format(amount);
        } catch {
            return `${prices.currency_symbol || ''}${amount.toFixed(units)}`;
        }
    };
    if (prices.price_range) {
        return `${format(prices.price_range.min_amount)} – ${format(prices.price_range.max_amount)}`;
    }
    return format(prices.price);
}

const BLOG_SOURCE_URL = 'https://diaryofafarmer.co.uk/farm';
const BLOG_PROXY_URL = 'blog-proxy.php';

async function initBlogSection() {
    const blogContainer = document.getElementById('blogPosts');
    if (!blogContainer) return;

    try {
        const posts = await fetchBlogPosts();
        if (!posts.length) {
            throw new Error('No posts were returned');
        }
        renderBlogPosts(blogContainer, posts.slice(0, 3));
    } catch (error) {
        console.error('Error loading blog posts:', error);
        blogContainer.innerHTML = `
            <p class="blog-status">
                Unable to load posts right now. 
                <a href="${BLOG_SOURCE_URL}" target="_blank" rel="noopener noreferrer">Visit the blog</a>.
            </p>
        `;
    } finally {
        blogContainer.setAttribute('aria-busy', 'false');
    }
}

async function fetchBlogPosts() {
    const loaders = [
        loadFromProxy,
        loadFromWordPressApi,
        loadFromFarmFeed
    ];

    for (const loader of loaders) {
        try {
            const posts = await loader();
            if (posts.length) return posts;
        } catch (error) {
            console.warn('Blog loader failed:', error);
        }
    }

    return [];
}

async function loadFromProxy() {
    const response = await fetch(BLOG_PROXY_URL);
    if (!response.ok) {
        throw new Error(`Proxy request failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
        throw new Error('Proxy returned an invalid payload');
    }

    return data.map((post) => ({
        title: stripHtml(post?.title || 'Untitled Post'),
        excerpt: truncateText(stripHtml(post?.excerpt || ''), 180),
        url: post?.url || BLOG_SOURCE_URL,
        date: post?.date || '',
        image: post?.image || ''
    }));
}

async function loadFromWordPressApi() {
    const response = await fetch('https://diaryofafarmer.co.uk/farm/wp-json/wp/v2/posts?per_page=3&_embed');
    if (!response.ok) {
        throw new Error(`WordPress API request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.map((post) => ({
        title: stripHtml(post?.title?.rendered || 'Untitled Post'),
        excerpt: truncateText(stripHtml(post?.excerpt?.rendered || ''), 180),
        url: post?.link || BLOG_SOURCE_URL,
        date: post?.date || '',
        image: post?._embedded?.['wp:featuredmedia']?.[0]?.source_url || firstImageUrl(post?.content?.rendered || '')
    }));
}

async function loadFromFarmFeed() {
    const response = await fetch(`${BLOG_SOURCE_URL}/feed/`);
    if (!response.ok) {
        throw new Error(`Feed request failed with status ${response.status}`);
    }

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'text/xml');
    if (xml.querySelector('parsererror')) {
        throw new Error('Invalid RSS feed response');
    }

    return Array.from(xml.querySelectorAll('item')).slice(0, 3).map((item) => {
        const content = item.getElementsByTagNameNS('http://purl.org/rss/1.0/modules/content/', 'encoded')[0]?.textContent || '';
        return {
            title: (item.querySelector('title')?.textContent || 'Untitled Post').trim(),
            excerpt: truncateText(stripHtml(item.querySelector('description')?.textContent || ''), 180),
            url: (item.querySelector('link')?.textContent || BLOG_SOURCE_URL).trim(),
            date: item.querySelector('pubDate')?.textContent || '',
            image: firstImageUrl(content)
        };
    });
}

function firstImageUrl(html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return document.querySelector('img[src]')?.getAttribute('src') || '';
}

function renderBlogPosts(container, posts) {
    container.innerHTML = '';

    posts.forEach((post) => {
        const article = document.createElement('article');
        article.className = 'blog-card';

        const formattedDate = formatBlogDate(post.date);
        const imageMarkup = post.image
            ? `<img src="${post.image}" alt="${escapeHtml(post.title)}" class="blog-image">`
            : `<div class="blog-image" aria-hidden="true"></div>`;

        article.innerHTML = `
            ${imageMarkup}
            <div class="blog-card-body">
                <p class="blog-date">${formattedDate}</p>
                <h3 class="blog-card-title">${escapeHtml(post.title)}</h3>
                <p class="blog-excerpt">${escapeHtml(post.excerpt || 'Read the full story on our blog.')}</p>
                <a class="blog-read-link" href="${post.url}" target="_blank" rel="noopener noreferrer">Read more <i class="fas fa-arrow-right"></i></a>
            </div>
        `;

        container.appendChild(article);
    });
}

function formatBlogDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Latest Post';
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(date);
}

function stripHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return (temp.textContent || temp.innerText || '').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trim()}...`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Initialize navigation functionality
function initNavigation() {
    const header = document.querySelector('body.homepage header[data-component="header"]');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navMenu = document.getElementById('navMenu');
    const dropdowns = document.querySelectorAll('.dropdown');
    const dropdownToggles = document.querySelectorAll('[data-dropdown-toggle]');
    const setMenuOpen = (open) => {
        if (!navMenu || !mobileMenuBtn) return;
        navMenu.classList.toggle('active', open);
        mobileMenuBtn.setAttribute('aria-expanded', String(open));
        mobileMenuBtn.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    };

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu > li > a').forEach(link => {
        if (link.getAttribute('href') === currentPage) link.setAttribute('aria-current', 'page');
    });

    if (mobileMenuBtn && navMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            setMenuOpen(!navMenu.classList.contains('active'));
        });

        // Close mobile menu when clicking a link
        document.querySelectorAll('.nav-link:not(.dropdown-toggle)').forEach(link => {
            link.addEventListener('click', () => {
                setMenuOpen(false);
                closeAllDropdowns();
            });
        });
    }

    const closeAllDropdowns = (except) => {
        dropdowns.forEach(dropdown => {
            if (except && dropdown === except) return;
            dropdown.classList.remove('open');
            const toggle = dropdown.querySelector('[data-dropdown-toggle]');
            if (toggle) {
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    };

    dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const dropdown = toggle.closest('.dropdown');
            if (!dropdown) return;

            const isOpen = dropdown.classList.contains('open');
            closeAllDropdowns(dropdown);
            dropdown.classList.toggle('open', !isOpen);
            toggle.setAttribute('aria-expanded', String(!isOpen));
        });
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.dropdown')) {
            closeAllDropdowns();
        }
        if (!event.target.closest('header')) setMenuOpen(false);
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const openToggle = document.querySelector('.dropdown.open [data-dropdown-toggle]');
        const menuWasOpen = navMenu?.classList.contains('active');
        closeAllDropdowns();
        setMenuOpen(false);
        if (menuWasOpen) mobileMenuBtn.focus();
        else if (openToggle) openToggle.focus();
    });
    const mobileQuery = window.matchMedia('(max-width: 1100px)');
    mobileQuery.addEventListener('change', () => {
        setMenuOpen(false);
        closeAllDropdowns();
    });

    if (header) {
        const updateHeaderOnScroll = () => {
            header.classList.toggle('is-scrolled', window.scrollY > 24);
        };
        updateHeaderOnScroll();
        window.addEventListener('scroll', updateHeaderOnScroll, { passive: true });
    }
}

function initHeroSlideshow() {
    const slides = Array.from(document.querySelectorAll('.hero-slide'));
    if (slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let activeSlide = 0;
    window.setInterval(() => {
        slides[activeSlide].classList.remove('is-active');
        activeSlide = (activeSlide + 1) % slides.length;
        slides[activeSlide].classList.add('is-active');
    }, 6000);
}

// Join button interaction
function initJoinButton() {
    const joinButton = document.getElementById('joinButton');
    if (!joinButton) return;

    joinButton.addEventListener('click', (e) => {
        e.preventDefault();

        // Create a simple form modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: #292723;
        `;

        modal.innerHTML = `
            <div style="background-color: white; padding: 2rem; border-radius: 10px; max-width: 500px; width: 90%;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h2 style="color: #292723; margin: 0;">Join Our Community</h2>
                    <button id="closeModal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #636e72;">&times;</button>
                </div>
                <p style="margin-bottom: 1.5rem;">Fill out this form to join the Diary of a Farmer community and get access to resources, networking, and opportunities.</p>
                <form id="joinForm">
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Full Name</label>
                        <input type="text" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 5px;" required>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Email Address</label>
                        <input type="email" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 5px;" required>
                    </div>
                    <div style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Interest Area</label>
                        <select style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 5px;">
                            <option>Farmer/Producer</option>
                            <option>Agribusiness</option>
                            <option>Investor</option>
                            <option>Cooperatives</option>
                            <option>Researcher/Advisor</option>
                        </select>
                    </div>
                    <button type="submit" style="background-color: #e4b64e; color: #292723; padding: 1rem 2rem; border: none; border-radius: 5px; font-weight: 600; width: 100%; cursor: pointer;">Submit Application</button>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // Close modal functionality
        document.getElementById('closeModal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        // Form submission
        document.getElementById('joinForm').addEventListener('submit', (e) => {
            e.preventDefault();
            alert('Thank you for your interest! We will contact you shortly with more information.');
            document.body.removeChild(modal);
        });

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    });
}

// Smooth scrolling for anchor links
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            e.preventDefault();
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
                });
            }
        });
    });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', loadComponents);
