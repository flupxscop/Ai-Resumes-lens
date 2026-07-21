"""Regression tests for structured resume parsing."""

from app.parser import ResumeParser


def test_parser_keeps_projects_out_of_skills_and_pairs_experience_records() -> None:
    parser = ResumeParser()
    text = """Nuntawat Chantaro
Work Experience
AI Intern
FPT Software Vietnam | Nov 2025 – Feb 2026
• Executed 600+ voice-command test cases.
Education
Bachelor of Science in Computer Science
Mahasarakham University | 2022 - 2026
Technical Skills
Programming: Python, SQL
Selected AI Projects
AI Resume Reviewer
• Built an ATS feedback pipeline.
"""
    sections = parser._detect_sections(text)
    experience = parser._extract_experience(sections["experience"])
    education = parser._extract_education(sections["education"])
    projects = parser._extract_projects(sections["projects"])
    skills = parser._extract_skills(sections["skills"])

    assert experience[0].title == "AI Intern"
    assert experience[0].company == "FPT Software Vietnam"
    assert experience[0].description == ["Executed 600+ voice-command test cases."]
    assert education[0].degree == "Bachelor of Science in Computer Science"
    assert education[0].institution == "Mahasarakham University"
    assert projects[0].name == "AI Resume Reviewer"
    assert "AI Resume Reviewer" not in skills


def test_parser_recovers_header_name_and_sections_from_two_column_pdf_text() -> None:
    parser = ResumeParser()
    text = """Bangkok, Thailand
2023 - Present
SOMCHAI DEVSTARS
Bangkok, Thailand | +66 81 234 5678 | somchai.dev@email.com
EDUCATION
CHULALONGKORN UNIVERSITY
TECHNICAL EXPERIENCE
TECHSOLUTION CO., LTD.
Senior Full-Stack Developer
• Built FastAPI services.
DIGITAL NEXUS INNOVATIONS
Full-Stack Developer
• Built React applications.
KEY PROJECTS
Enterprise Resource Management System
• Architected a dashboard.
SKILLS, TOOLS & LANGUAGES
Backend Technologies: Python, FastAPI, PostgreSQL
"""

    sections = parser._detect_sections(text)
    assert parser._extract_name(text) == "Somchai Devstars"
    assert len(parser._extract_experience(sections["experience"])) == 2
    assert parser._extract_projects(sections["projects"])[0].name == "Enterprise Resource Management System"
    assert "Python" in parser._extract_skills(sections["skills"])


def test_parser_recovers_sidebar_template_name_and_title_company_experience() -> None:
    parser = ResumeParser()
    text = """2023 - Present
CONTACT
somchai.dev@email.com
TECHNICAL SKILLS
Python, FastAPI, AWS (S3, EC2)
LANGUAGES
THAI
Somchai Devstars
SENIOR FULL-STACK DEVELOPER
PROFESSIONAL SUMMARY
Experienced developer.
WORK EXPERIENCE
Senior Full-Stack Developer
TechSolution Co., Ltd.
• Built FastAPI services.
Full-Stack Developer
Digital Nexus Innovations
• Built React applications.
EDUCATION
Bachelor of Science in Computer Science
Chulalongkorn University
"""

    sections = parser._detect_sections(text)
    experience = parser._extract_experience(sections["experience"])
    education = parser._extract_education(sections["education"])

    assert parser._extract_name(text) == "Somchai Devstars"
    assert [role.company for role in experience] == ["TechSolution Co., Ltd.", "Digital Nexus Innovations"]
    assert experience[0].title == "Senior Full-Stack Developer"
    assert education[0].institution == "Chulalongkorn University"
    assert education[0].degree == "Bachelor of Science in Computer Science"
