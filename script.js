// Load header and footer components
async function loadComponents() {
    // Load header
    const headerElement = document.querySelector('header');
    if (headerElement && headerElement.dataset.component === 'header') {
        try {
            const response = await fetch('components/header.html');
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
    initJoinButton();
    initSmoothScroll();
    initScrollEffect();
    initBlogSection();
    initMarketplaceSection();
    initContactForm();
    initConsultationForm();
}

const BLOG_SOURCE_URL = 'https://diaryofafarmer.co.uk/farm';
const BLOG_PROXY_URL = 'blog-proxy.php';

const SHOP_SOURCE_URL = 'https://diaryofafarmer.co.uk/farm/shop';
const PRODUCTS_PROXY_URL = 'products-proxy.php';

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
    }
}

async function initMarketplaceSection() {
    const marketplaceContainer = document.getElementById('marketplaceProducts');
    if (!marketplaceContainer) return;

    try {
        const products = await fetchWooCommerceProducts();
        if (!products.length) {
            throw new Error('No products were returned');
        }
        renderMarketplaceProducts(marketplaceContainer, products.slice(0, 4));
    } catch (error) {
        console.error('Error loading marketplace products:', error);
        marketplaceContainer.innerHTML = `
            <p class="marketplace-status">
                Unable to load products right now. 
                <a href="${SHOP_SOURCE_URL}" target="_blank" rel="noopener noreferrer">Visit the shop</a>.
            </p>
        `;
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
    const response = await fetch('https://diaryofafarmer.co.uk/wp-json/wp/v2/posts?per_page=3&_embed');
    if (!response.ok) {
        throw new Error(`WordPress API request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.map((post) => ({
        title: stripHtml(post?.title?.rendered || 'Untitled Post'),
        excerpt: truncateText(stripHtml(post?.excerpt?.rendered || ''), 180),
        url: post?.link || BLOG_SOURCE_URL,
        date: post?.date || '',
        image: post?._embedded?.['wp:featuredmedia']?.[0]?.source_url || ''
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

    return Array.from(xml.querySelectorAll('item')).slice(0, 3).map((item) => ({
        title: (item.querySelector('title')?.textContent || 'Untitled Post').trim(),
        excerpt: truncateText(stripHtml(item.querySelector('description')?.textContent || ''), 180),
        url: (item.querySelector('link')?.textContent || BLOG_SOURCE_URL).trim(),
        date: item.querySelector('pubDate')?.textContent || '',
        image: ''
    }));
}

function renderBlogPosts(container, posts) {
    container.innerHTML = '';

    posts.forEach((post) => {
        const article = document.createElement('article');
        article.className = 'blog-card';

        const formattedDate = formatBlogDate(post.date);
        const safeUrl = sanitizeExternalUrl(post.url, BLOG_SOURCE_URL);
        const safeImage = sanitizeExternalUrl(post.image, '');
        const imageMarkup = safeImage
            ? `<img src="${escapeHtml(safeImage)}" alt="${escapeHtml(post.title)}" class="blog-image">`
            : `<div class="blog-image" aria-hidden="true"></div>`;

        article.innerHTML = `
            ${imageMarkup}
            <div class="blog-card-body">
                <p class="blog-date">${formattedDate}</p>
                <h3 class="blog-card-title">${escapeHtml(post.title)}</h3>
                <p class="blog-excerpt">${escapeHtml(post.excerpt || 'Read the full story on our blog.')}</p>
                <a class="blog-read-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Read more <i class="fas fa-arrow-right"></i></a>
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

function sanitizeExternalUrl(value, fallback) {
    if (!value) return fallback;

    try {
        const parsed = new URL(value, window.location.href);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return fallback;
        }
        return parsed.href;
    } catch (error) {
        return fallback;
    }
}

async function fetchWooCommerceProducts() {
    try {
        const response = await fetch(`${PRODUCTS_PROXY_URL}?per_page=4&orderby=date&order=desc`);
        if (!response.ok) {
            throw new Error(`Products proxy request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
            throw new Error('Products proxy returned an invalid payload');
        }

        return data.map((product) => ({
            id: product?.id || '',
            title: stripHtml(product?.title || 'Untitled Product'),
            description: truncateText(stripHtml(product?.description || ''), 120),
            price: product?.price || '0',
            image: product?.image || '',
            url: product?.url || SHOP_SOURCE_URL,
            sale_price: product?.sale_price || null,
            regular_price: product?.regular_price || product?.price || '0'
        }));
    } catch (error) {
        console.warn('Products proxy fetch failed:', error);
        return [];
    }
}

function renderMarketplaceProducts(container, products) {
    container.innerHTML = '';

    if (!products.length) {
        container.innerHTML = `<p class="marketplace-status">No products available at the moment.</p>`;
        return;
    }

    products.forEach((product) => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';

        const safeUrl = sanitizeExternalUrl(product.url, SHOP_SOURCE_URL);
        const safeImage = sanitizeExternalUrl(product.image, '');
        const imageMarkup = safeImage
            ? `<img src="${escapeHtml(safeImage)}" alt="${escapeHtml(product.title)}" class="product-image">`
            : `<div class="product-image" aria-hidden="true"></div>`;

        const priceMarkup = product.sale_price && product.sale_price < product.regular_price
            ? `<div class="product-price"><span class="original-price">$${parseFloat(product.regular_price).toFixed(2)}</span><span class="sale-price">$${parseFloat(product.sale_price).toFixed(2)}</span></div>`
            : `<div class="product-price">$${parseFloat(product.price).toFixed(2)}</div>`;

        productCard.innerHTML = `
            <div class="product-image-wrapper">
                ${imageMarkup}
                <div class="product-overlay">
                    <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="view-product-btn">View Details <i class="fas fa-arrow-right"></i></a>
                </div>
            </div>
            <div class="product-card-body">
                <h3 class="product-title">${escapeHtml(product.title)}</h3>
                <p class="product-description">${escapeHtml(product.description)}</p>
                ${priceMarkup}
            </div>
        `;

        container.appendChild(productCard);
    });
}

// Initialize navigation functionality
function initNavigation() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navMenu = document.getElementById('navMenu');
    const dropdowns = document.querySelectorAll('.dropdown');
    const dropdownToggles = document.querySelectorAll('[data-dropdown-toggle]');

    if (mobileMenuBtn && navMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            mobileMenuBtn.innerHTML = navMenu.classList.contains('active')
                ? '<i class="fas fa-times"></i>'
                : '<i class="fas fa-bars"></i>';
        });

        // Close mobile menu when clicking a link
        document.querySelectorAll('.nav-link:not(.dropdown-toggle)').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                mobileMenuBtn.innerHTML = '<i class="fas fa-bars"></i>';
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
    });
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
        `;

        modal.innerHTML = `
            <div style="background-color: white; padding: 2rem; border-radius: 10px; max-width: 500px; width: 90%;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h2 style="color: #1b5e20; margin: 0;">Join Our Community</h2>
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
                    <button type="submit" style="background-color: #2a7d2a; color: white; padding: 1rem 2rem; border: none; border-radius: 5px; font-weight: 600; width: 100%; cursor: pointer;">Submit Application</button>
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
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Add scroll effect to header
function initScrollEffect() {
    window.addEventListener('scroll', () => {
        const header = document.querySelector('header');
        if (header) {
            if (window.scrollY > 100) {
                header.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.12)';
            } else {
                header.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.08)';
            }
        }
    });
}

async function submitFormData(form, formType) {
    const formData = new FormData(form);
    formData.set('form_type', formType);

    const response = await fetch('submit-form.php', {
        method: 'POST',
        body: formData
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(payload?.error || `Form request failed with status ${response.status}`);
    }

    if (!payload?.ok) {
        throw new Error(payload?.error || 'Submission failed');
    }
}

function showConsultationRequestPopup(title, message) {
    const popup = document.createElement('div');
    popup.className = 'request-popup-overlay';
    popup.innerHTML = `
        <div class="request-popup" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
            <button type="button" class="request-popup-close" aria-label="Close popup">&times;</button>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(message)}</p>
            <button type="button" class="request-popup-action">OK</button>
        </div>
    `;

    document.body.appendChild(popup);

    const closePopup = () => {
        if (popup.parentNode) {
            popup.parentNode.removeChild(popup);
        }
    };

    popup.querySelector('.request-popup-close')?.addEventListener('click', closePopup);
    popup.querySelector('.request-popup-action')?.addEventListener('click', closePopup);
    popup.addEventListener('click', (event) => {
        if (event.target === popup) {
            closePopup();
        }
    });
}

function initContactForm() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
            await submitFormData(form, 'contact');
            alert('Your message has been received. We will get back to you soon.');
            form.reset();
        } catch (error) {
            console.error('Contact form submission failed:', error);
            alert('Unable to send your message right now. Please try again shortly.');
        }
    });
}

function initConsultationForm() {
    const form = document.getElementById('consultationForm');
    if (!form) return;
    const submitButton = form.querySelector('button[type="submit"]');
    const defaultButtonLabel = submitButton ? submitButton.innerHTML : '';

    let statusMessage = form.querySelector('.consultation-submit-status');
    if (!statusMessage && submitButton) {
        statusMessage = document.createElement('p');
        statusMessage.className = 'consultation-submit-status';
        statusMessage.setAttribute('aria-live', 'polite');
        submitButton.insertAdjacentElement('afterend', statusMessage);
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (form.dataset.submitting === 'true') {
            return;
        }

        const fileInput = document.getElementById('file-upload');
        const selectedFile = fileInput?.files?.[0];
        const maxSizeBytes = 5 * 1024 * 1024;

        if (selectedFile && selectedFile.size > maxSizeBytes) {
            alert('The selected file exceeds the 5MB limit.');
            return;
        }

        form.dataset.submitting = 'true';
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.classList.add('is-loading');
            submitButton.textContent = 'Processing request...';
        }
        if (statusMessage) {
            statusMessage.classList.remove('error');
            statusMessage.textContent = 'Processing your consultation request...';
        }

        try {
            await submitFormData(form, 'consultation');
            if (statusMessage) {
                statusMessage.textContent = '';
            }
            form.reset();
            showConsultationRequestPopup(
                'Request Received',
                'Your consultation request has been sent successfully. We will contact you to confirm details.'
            );
        } catch (error) {
            console.error('Consultation form submission failed:', error);
            if (statusMessage) {
                statusMessage.classList.add('error');
                statusMessage.textContent = error?.message || 'Unable to submit your consultation request right now. Please try again shortly.';
            }
            alert(error?.message || 'Unable to submit your consultation request right now. Please try again shortly.');
        } finally {
            form.dataset.submitting = 'false';
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.classList.remove('is-loading');
                submitButton.innerHTML = defaultButtonLabel;
            }
        }
    });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', loadComponents);
