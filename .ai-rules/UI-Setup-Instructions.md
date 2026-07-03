# Assistant Coach UI Setup Guide

This guide provides step-by-step instructions for replicating the Assistant Coach web UI in a new Flask project. The UI features a modern, responsive design with dark theme, shared layout shell, and key marketing components.

## Prerequisites

- Python 3.8+
- Flask
- Basic HTML/CSS knowledge
- Remix Icon library (CDN or local)

## Project Structure

Create the following directory structure:

```text
your-project/
├── app.py
├── static/
│   └── css/
│       └── app.css
├── templates/
│   ├── base.html
│   ├── landing.html
│   ├── plans.html
│   └── [other templates]
└── requirements.txt
```

## 1. Base Template (templates/base.html)

Create the shared layout shell:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{% block title %}Your App{% endblock %}</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='css/app.css') }}">
  <link href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css" rel="stylesheet">
</head>
<body>
  <header class="app-header">
    <nav class="primary-nav">
      <a href="{{ url_for('index') }}" class="brand">
        <i class="ri-baseball-line" aria-hidden="true"></i>
        Your App
      </a>
      <div>
        <a href="{{ url_for('plans') }}">Plans</a>
        <a href="{{ url_for('login') }}">Login</a>
      </div>
    </nav>
  </header>

  <main>
    {% block content %}{% endblock %}
  </main>

  <footer class="app-footer">
    <p>&copy; 2025 Your App. All rights reserved.</p>
  </footer>
</body>
</html>
```

## 2. CSS Styles (static/css/app.css)

Copy the complete CSS from `static/css/app.css` in this project. Key features:

- CSS custom properties for colors
- Responsive grid layouts
- Button and form styling
- Surface cards with backdrop blur
- Testimonial ticker animation
- Mobile-first responsive design

## 3. Landing Page (templates/landing.html)

```html
{% extends "base.html" %}

{% block title %}Your App · Welcome{% endblock %}

{% block content %}
  <section class="hero-shell">
    <div>
      <h1>Your App Tagline</h1>
      <p>Your description here.</p>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <a class="btn" href="{{ url_for('trial') }}">Start Trial</a>
        <a class="btn secondary" href="{{ url_for('plans') }}">View Plans</a>
      </div>
    </div>
    <div class="surface-card">
      <h2>Why Choose Your App</h2>
      
      <!-- Testimonial Ticker -->
      <div class="testimonial-ticker" aria-label="User testimonials">
        <div class="testimonial-track">
          <!-- Add testimonial items here -->
        </div>
      </div>
      
      <!-- Feature Cards -->
      <div style="display:grid; gap:14px;">
        <!-- Add feature cards -->
      </div>
    </div>
  </section>

  <section class="content-grid">
    <!-- Add content sections -->
  </section>
{% endblock %}
```

## 4. Plans Page (templates/plans.html)

```html
{% extends "base.html" %}

{% block title %}Pricing Plans{% endblock %}

{% block content %}
  <section class="page-shell">
    <div class="section-intro">
      <h1>Choose Your Plan</h1>
      <p>Transparent pricing for coaches.</p>
    </div>
    
    <!-- Free Trial Card -->
    <div class="plan-card" style="background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(59,130,246,0.24)); border: 1px solid rgba(99,102,241,0.45); border-radius: 20px; padding: 28px; display: grid; gap: 14px; box-shadow: 0 18px 40px -24px rgba(59,130,246,0.65);">
      <div style="display:flex; align-items:center; gap:10px; text-transform: uppercase; letter-spacing:0.12em; font-weight:700; color: rgba(233, 238, 255, 0.95);">
        <i class="ri-rocket-line" aria-hidden="true"></i>
        Free Trial First
      </div>
      <h2 style="margin:0; font-size:1.75rem; line-height:1.2;">Try before you buy</h2>
      <p class="muted" style="margin:0; color:rgba(226,232,240,0.92);">
        Full access during trial—no credit card required.
      </p>
      <ul style="list-style:none; margin:0; padding:0; display:grid; gap:8px;">
        <li style="display:flex; gap:8px; align-items:flex-start;">
          <i class="ri-checkbox-circle-fill" aria-hidden="true" style="color:var(--emerald-500);"></i>
          <span>Feature 1</span>
        </li>
        <!-- Add more features -->
      </ul>
      <div style="display:flex; flex-wrap:wrap; gap:12px;">
        <a class="btn" href="{{ url_for('trial') }}">Start Free Trial</a>
      </div>
    </div>
    
    <!-- Subscription Plans -->
    <div class="plan-grid" style="display: grid; gap: 16px;">
      <!-- Add plan cards -->
    </div>
  </section>
{% endblock %}
```

## 5. Flask Routes (app.py)

Add these routes to your Flask app:

```python
from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('landing.html')

@app.route('/plans')
def plans():
    # Add subscription plan data
    subscription_plans = {
        'monthly': {'label': 'Monthly', 'amount': '9.99', 'billing_cycle': 'monthly'},
        'annual': {'label': 'Annual', 'amount': '100', 'billing_cycle': 'yearly'}
    }
    return render_template('plans.html', subscription_plans=subscription_plans)

@app.route('/trial')
def trial():
    return render_template('trial.html')

@app.route('/login')
def login():
    return render_template('login.html')

if __name__ == '__main__':
    app.run(debug=True)
```

## 6. Requirements (requirements.txt)

```
Flask==2.3.3
```

## 7. Customization Tips

- **Colors**: Modify CSS custom properties in `:root` for branding
- **Testimonials**: Update coach names and quotes in landing.html
- **Plans**: Adjust pricing and features in plans.html and app.py
- **Icons**: Use Remix Icon classes (ri-*) throughout
- **Responsive**: Test on mobile; adjust grid columns and padding as needed

## 8. Testing

- Run `python app.py` and visit `http://localhost:5000`
- Check responsive design on different screen sizes
- Verify testimonial ticker animation and hover pause
- Test button hover states and form interactions

## 9. Deployment

- Use the same Dockerfile and docker-compose.yml from this project
- Set environment variables for production
- Deploy to Railway or similar platform

This setup provides a solid foundation for a coach-focused SaaS application with modern UI patterns.
