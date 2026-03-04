using Microsoft.AspNetCore.Mvc;

namespace SpearTips.Controllers;

public class HomeController : Controller
{
    public IActionResult Index() => View();
}
